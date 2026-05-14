"use strict";

const DEFAULT_API_BASE_URL = "https://guard-api.xero-x.me";
const DISCORD_CLIENT_ID = "1503177107910561954";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const API_BASE_STORAGE_KEY = "discat_guard_certification_api_base";
const PRODUCTION_ORIGIN = "https://xero-x.me";
const DISCORD_SNOWFLAKE_PATTERN = /^\d+$/;
const VERIFY_HOLD_DURATION_MS = 2000;
const DEFAULT_VERIFY_BUTTON_LABEL = "2秒長押しで認証";

const elements = {
  statusLabel: document.querySelector("[data-status-label]"),
  panel: document.querySelector("[data-state-panel]"),
  title: document.querySelector("[data-state-title]"),
  message: document.querySelector("[data-state-message]"),
  button: document.querySelector("[data-verify-button]"),
  buttonLabel: document.querySelector("[data-button-label]"),
  serverName: document.querySelector("[data-server-name]"),
  serverCard: document.querySelector("[data-server-card]"),
  serverIconImage: document.querySelector("[data-server-icon-image]"),
  returnActions: document.querySelector("[data-return-actions]"),
  returnAppLink: document.querySelector("[data-return-app-link]"),
  returnWebLink: document.querySelector("[data-return-web-link]"),
};

const params = new URLSearchParams(window.location.search);
const oauthCode = String(params.get("code") ?? "").trim();
const oauthError = String(params.get("error") ?? "").trim();
const rawOauthState = String(params.get("state") ?? "").trim();
const oauthState = parseOAuthState(rawOauthState);
const token = String(params.get("token") ?? oauthState.token ?? "").trim();
const guildId = String(params.get("guild_id") ?? oauthState.guildId ?? "").trim();
const apiBase = resolveApiBase();
let discordReturnTarget = buildDiscordReturnTarget(guildId);
let buttonAction = startDiscordOAuth;
const holdState = {
  active: false,
  completed: false,
  startedAt: 0,
  pointerId: null,
  timerId: 0,
  frameId: 0,
  baseLabel: DEFAULT_VERIFY_BUTTON_LABEL,
};

void boot();

async function boot() {
  initializeVerifyHoldButton();
  elements.serverIconImage?.addEventListener("error", () => {
    elements.serverIconImage.hidden = true;
    delete elements.serverCard?.dataset.hasIcon;
  });

  if (oauthError) {
    setState({
      status: "認証キャンセル",
      title: "Discord認証が完了していません",
      message: "",
      tone: "error",
      disabled: false,
      button: "認証する",
    });
    return;
  }

  if (!apiBase) {
    setState({
      status: "設定エラー",
      title: "Guard API URLが未設定です",
      message: "",
      tone: "error",
      disabled: true,
      button: "認証不可",
    });
    return;
  }

  if (!token && !guildId) {
    setState({
      status: "リンクエラー",
      title: "認証先サーバーが不足しています",
      message: "",
      tone: "error",
      disabled: true,
      button: "認証不可",
    });
    return;
  }

  try {
    const canContinue = token ? await loadSessionContext() : await loadGuildContext();
    if (!canContinue) {
      return;
    }
  } catch (error) {
    setState({
      status: "認証失敗",
      title: "認証できませんでした",
      message: connectionErrorMessage(error),
      tone: "error",
      disabled: false,
      button: "認証する",
    });
    return;
  }

  if (oauthCode) {
    void completeOAuthVerification();
  }
}

function initializeVerifyHoldButton() {
  const button = elements.button;
  if (!button) {
    return;
  }
  button.style.setProperty("--hold-progress", "0");
  button.addEventListener("pointerdown", beginVerifyHold);
  button.addEventListener("pointerup", cancelVerifyHold);
  button.addEventListener("pointercancel", cancelVerifyHold);
  button.addEventListener("pointerleave", cancelVerifyHold);
  button.addEventListener("lostpointercapture", cancelVerifyHold);
  button.addEventListener("keydown", handleVerifyHoldKeyDown);
  button.addEventListener("keyup", handleVerifyHoldKeyUp);
  button.addEventListener("blur", cancelVerifyHold);
  button.addEventListener("contextmenu", (event) => {
    if (holdState.active) {
      event.preventDefault();
    }
  });
}

function beginVerifyHold(event) {
  const button = elements.button;
  if (!button || button.disabled || holdState.active || holdState.completed) {
    return;
  }
  const isPointerEvent = typeof PointerEvent !== "undefined" && event instanceof PointerEvent;
  if (isPointerEvent && event.button !== 0) {
    return;
  }
  event.preventDefault();
  holdState.active = true;
  holdState.completed = false;
  holdState.startedAt = performance.now();
  holdState.baseLabel = elements.buttonLabel?.textContent || DEFAULT_VERIFY_BUTTON_LABEL;
  holdState.pointerId = isPointerEvent ? event.pointerId : null;
  if (holdState.pointerId !== null && typeof button.setPointerCapture === "function") {
    try {
      button.setPointerCapture(holdState.pointerId);
    } catch {
      // Pointer capture is a nicety, not a requirement.
    }
  }
  button.classList.add("is-holding");
  button.classList.remove("is-complete");
  updateVerifyHoldProgress(0);
  holdState.timerId = window.setTimeout(completeVerifyHold, VERIFY_HOLD_DURATION_MS);
  holdState.frameId = window.requestAnimationFrame(updateVerifyHoldFrame);
}

function handleVerifyHoldKeyDown(event) {
  if (![" ", "Enter"].includes(event.key) || event.repeat) {
    return;
  }
  beginVerifyHold(event);
}

function handleVerifyHoldKeyUp(event) {
  if (![" ", "Enter"].includes(event.key)) {
    return;
  }
  cancelVerifyHold();
}

function updateVerifyHoldFrame(now) {
  if (!holdState.active) {
    return;
  }
  const elapsed = Math.max(0, now - holdState.startedAt);
  updateVerifyHoldProgress(Math.min(1, elapsed / VERIFY_HOLD_DURATION_MS));
  holdState.frameId = window.requestAnimationFrame(updateVerifyHoldFrame);
}

function updateVerifyHoldProgress(progress) {
  elements.button?.style.setProperty("--hold-progress", progress.toFixed(3));
  if (!elements.buttonLabel) {
    return;
  }
  if (progress >= 1) {
    elements.buttonLabel.textContent = "認証へ進みます";
    return;
  }
  const remaining = Math.max(1, Math.ceil((VERIFY_HOLD_DURATION_MS * (1 - progress)) / 1000));
  elements.buttonLabel.textContent = `そのまま長押し ${remaining}秒`;
}

function completeVerifyHold() {
  if (!holdState.active) {
    return;
  }
  clearVerifyHoldTimers();
  releaseVerifyPointerCapture();
  holdState.active = false;
  holdState.completed = true;
  elements.button?.classList.remove("is-holding");
  elements.button?.classList.add("is-complete");
  elements.button?.style.setProperty("--hold-progress", "1");
  if (elements.button) {
    elements.button.disabled = true;
  }
  if (elements.buttonLabel) {
    elements.buttonLabel.textContent = "認証へ進みます";
  }
  void Promise.resolve(buttonAction()).catch((error) => {
    setState({
      status: "認証失敗",
      title: "認証できませんでした",
      message: connectionErrorMessage(error),
      tone: "error",
      disabled: false,
      button: "認証する",
    });
  });
}

function cancelVerifyHold() {
  if (!holdState.active) {
    return;
  }
  clearVerifyHoldTimers();
  releaseVerifyPointerCapture();
  holdState.active = false;
  elements.button?.classList.remove("is-holding");
  elements.button?.style.setProperty("--hold-progress", "0");
  if (elements.buttonLabel) {
    elements.buttonLabel.textContent = holdState.baseLabel || DEFAULT_VERIFY_BUTTON_LABEL;
  }
}

function resetVerifyHoldButton() {
  cancelVerifyHold();
  holdState.completed = false;
  elements.button?.classList.remove("is-holding", "is-complete");
  elements.button?.style.setProperty("--hold-progress", "0");
}

function clearVerifyHoldTimers() {
  window.clearTimeout(holdState.timerId);
  window.cancelAnimationFrame(holdState.frameId);
  holdState.timerId = 0;
  holdState.frameId = 0;
}

function releaseVerifyPointerCapture() {
  const button = elements.button;
  if (button && holdState.pointerId !== null && typeof button.releasePointerCapture === "function") {
    try {
      button.releasePointerCapture(holdState.pointerId);
    } catch {
      // The pointer may already have been released.
    }
  }
  holdState.pointerId = null;
}

function startDiscordOAuth() {
  if ((!token && !guildId) || !apiBase) {
    return;
  }
  try {
    window.localStorage.setItem(API_BASE_STORAGE_KEY, apiBase);
  } catch {
    // Storage is optional.
  }
  const authUrl = new URL(DISCORD_AUTHORIZE_URL);
  const state = token ? `token:${token}` : `guild:${guildId}`;
  authUrl.search = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: currentRedirectUri(),
    response_type: "code",
    scope: "identify",
    state,
  }).toString();
  window.location.href = authUrl.toString();
}

async function completeOAuthVerification() {
  setState({
    status: "認証中",
    title: "認証中です",
    message: "",
    disabled: true,
    button: "認証中",
  });

  try {
    const response = await fetch(`${apiBase}/verify/oauth/complete`, {
      method: "POST",
      body: JSON.stringify({
        token,
        guild_id: guildId,
        code: oauthCode,
        redirect_uri: currentRedirectUri(),
        device: devicePayload(),
      }),
      cache: "no-store",
      credentials: "omit",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(verificationErrorMessage(response.status, payload));
    }

    if (isAlreadyVerifiedCompletion(payload)) {
      window.history.replaceState({}, "", currentRedirectUri());
      showAlreadyVerified(payload);
      return;
    }

    const duplicate = Boolean(payload.duplicate_detected);
    rememberDiscordReturn(payload);
    window.history.replaceState({}, "", currentRedirectUri());
    setState({
      status: duplicate ? "重複検知" : "認証完了",
      title: duplicate ? "認証を記録しました" : "認証完了しました。",
      message: "",
      tone: duplicate ? "warning" : "success",
      disabled: true,
      button: "完了",
    });
    showReturnActions();
  } catch (error) {
    setState({
      status: "認証失敗",
      title: "認証できませんでした",
      message: connectionErrorMessage(error),
      tone: "error",
      disabled: false,
      button: "認証する",
    });
  }
}

async function loadSessionContext() {
  const response = await fetch(`${apiBase}/verify/session?token=${encodeURIComponent(token)}`, {
    cache: "no-store",
    credentials: "omit",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(verificationErrorMessage(response.status, payload));
  }
  rememberDiscordReturn(payload);
  renderServer(payload.guild);
  if (payload.already_verified) {
    showAlreadyVerified(payload);
    return false;
  }
  return true;
}

async function loadGuildContext() {
  const response = await fetch(`${apiBase}/verify/guild?guild_id=${encodeURIComponent(guildId)}`, {
    cache: "no-store",
    credentials: "omit",
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(verificationErrorMessage(response.status, payload));
  }
  rememberDiscordReturn(payload);
  renderServer(payload.guild);
  return true;
}

function renderServer(guild) {
  const name = typeof guild?.name === "string" && guild.name.trim() ? guild.name.trim() : "Unknown Server";
  const iconUrl = typeof guild?.icon_url === "string" ? guild.icon_url : "";
  if (elements.serverName) {
    elements.serverName.textContent = name;
  }
  if (elements.serverIconImage) {
    if (iconUrl) {
      elements.serverIconImage.src = iconUrl;
      elements.serverIconImage.hidden = false;
      if (elements.serverCard) {
        elements.serverCard.dataset.hasIcon = "true";
      }
    } else {
      elements.serverIconImage.removeAttribute("src");
      elements.serverIconImage.hidden = true;
      delete elements.serverCard?.dataset.hasIcon;
    }
  }
}

function rememberDiscordReturn(payload = {}) {
  const nextTarget = normalizeDiscordReturn(payload?.discord_return, payload?.guild);
  if (nextTarget) {
    discordReturnTarget = nextTarget;
  }
  return discordReturnTarget;
}

function normalizeDiscordReturn(rawTarget, guild) {
  const fallbackGuildId = cleanSnowflake(guild?.id) || cleanSnowflake(guildId);
  const targetGuildId = cleanSnowflake(rawTarget?.guild_id) || fallbackGuildId;
  if (!targetGuildId) {
    return null;
  }
  const targetChannelId = cleanSnowflake(rawTarget?.channel_id);
  return buildDiscordReturnTarget(targetGuildId, targetChannelId);
}

function buildDiscordReturnTarget(targetGuildId, targetChannelId = "") {
  const resolvedGuildId = cleanSnowflake(targetGuildId);
  if (!resolvedGuildId) {
    return null;
  }
  const resolvedChannelId = cleanSnowflake(targetChannelId);
  const channelPath = resolvedChannelId ? `${resolvedGuildId}/${resolvedChannelId}` : resolvedGuildId;
  return {
    guildId: resolvedGuildId,
    channelId: resolvedChannelId,
    appUrl: `discord://-/channels/${channelPath}`,
    webUrl: `https://discord.com/channels/${channelPath}`,
  };
}

function cleanSnowflake(value) {
  const raw = String(value ?? "").trim();
  return DISCORD_SNOWFLAKE_PATTERN.test(raw) ? raw : "";
}

function showReturnActions() {
  const target = discordReturnTarget;
  if (!target || !elements.returnActions || !elements.returnAppLink || !elements.returnWebLink) {
    return;
  }
  elements.returnAppLink.href = target.appUrl;
  elements.returnWebLink.href = target.webUrl;
  elements.returnActions.hidden = false;
}

function hideReturnActions() {
  if (elements.returnActions) {
    elements.returnActions.hidden = true;
  }
}

function showAlreadyVerified(payload = {}) {
  rememberDiscordReturn(payload);
  setState({
    status: "認証済み",
    title: "既に認証済みです。",
    message: "",
    tone: "success",
    disabled: true,
    button: "完了",
  });
  showReturnActions();
}

function isAlreadyVerifiedCompletion(payload = {}) {
  if (payload?.was_already_verified === true) {
    return true;
  }
  if (payload?.verification_completed === true) {
    return false;
  }
  const hasCompletionRecord = payload?.record && typeof payload.record === "object";
  return payload?.already_verified === true && !hasCompletionRecord;
}

function currentRedirectUri() {
  return `${window.location.origin}${window.location.pathname}`;
}

function parseOAuthState(value) {
  const raw = String(value ?? "").trim();
  if (raw.startsWith("guild:")) {
    return { guildId: raw.slice("guild:".length), token: "" };
  }
  if (raw.startsWith("token:")) {
    return { guildId: "", token: raw.slice("token:".length) };
  }
  return { guildId: "", token: raw };
}

function resolveApiBase() {
  const fromQuery = cleanApiBase(params.get("apiBase"));
  if (fromQuery) {
    try {
      window.localStorage.setItem(API_BASE_STORAGE_KEY, fromQuery);
    } catch {
      // Storage is optional for this public page.
    }
    return fromQuery;
  }

  const defaultApiBase = cleanApiBase(DEFAULT_API_BASE_URL);
  if (window.location.origin === PRODUCTION_ORIGIN) {
    try {
      window.localStorage.setItem(API_BASE_STORAGE_KEY, defaultApiBase);
    } catch {
      // Storage is optional for this public page.
    }
    return defaultApiBase;
  }

  try {
    const stored = cleanApiBase(window.localStorage.getItem(API_BASE_STORAGE_KEY));
    if (stored) {
      return stored;
    }
  } catch {
    // Fall back to the compiled default.
  }

  return defaultApiBase;
}

function cleanApiBase(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }
    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function devicePayload() {
  const screenInfo = window.screen ? `${screen.width}x${screen.height}x${screen.colorDepth}` : "";
  return {
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    platform: navigator.platform || "",
    screen: screenInfo,
    languages: Array.isArray(navigator.languages) ? navigator.languages.join(",") : navigator.language || "",
    hardware_concurrency: navigator.hardwareConcurrency || "",
    device_memory: navigator.deviceMemory || "",
    touch_points: navigator.maxTouchPoints || "",
  };
}

function verificationErrorMessage(status, payload) {
  const error = typeof payload?.error === "string" ? payload.error : "";
  const messages = {
    invalid_token: "認証リンクが無効です。Discordからもう一度認証リンクを開いてください。",
    expired_token: "認証リンクの有効期限が切れています。Discordからもう一度認証リンクを開いてください。",
    already_completed: "この認証リンクは使用済みです。Discordからもう一度認証リンクを開いてください。",
    already_verified: "既に認証済みです。",
    missing_token: "認証トークンが送信されていません。",
    missing_guild_id: "認証先サーバーが指定されていません。",
    missing_code: "Discord認証コードが送信されていません。",
    invalid_redirect_uri: "Discord OAuth2のリダイレクトURIが許可されていません。",
    oauth_required: "Discord OAuth2での認証が必要です。",
    oauth_not_configured: "Guard API側のDiscord OAuth2設定が不足しています。",
    verification_not_configured: "このサーバーでは認証設定がまだ完了していません。",
    discord_user_mismatch: "Discordで認証したアカウントが、認証ボタンを押したアカウントと一致しません。",
    discord_token_exchange_failed: "Discord OAuth2の認証コード確認に失敗しました。",
    discord_user_fetch_failed: "Discordアカウント情報を取得できませんでした。",
  };
  const detail = typeof payload?.message === "string" ? payload.message.trim() : "";
  if (detail && ["discord_token_exchange_failed", "discord_user_fetch_failed"].includes(error)) {
    return `${messages[error] ?? "Discord OAuth2の処理に失敗しました。"} ${detail}`;
  }
  if (messages[error]) {
    return messages[error];
  }
  if (detail) {
    return detail;
  }
  if (status === 0) {
    return "Guard APIに接続できませんでした。API URLとCloudflare Tunnelを確認してください。";
  }
  return `Guard APIへのリクエストに失敗しました。HTTP ${status}`;
}

function connectionErrorMessage(error) {
  const message = error instanceof Error ? error.message : "";
  if (!message || message === "Failed to fetch" || message === "Load failed" || message.includes("NetworkError")) {
    return `Guard APIに接続できませんでした。接続先 ${apiBase} を確認してください。`;
  }
  return message;
}

function setState({ status, title, message, tone = "", disabled = false, button = "認証する" }) {
  hideReturnActions();
  resetVerifyHoldButton();
  if (elements.statusLabel) {
    elements.statusLabel.textContent = status;
  }
  if (elements.title) {
    elements.title.textContent = title;
  }
  if (elements.message) {
    elements.message.textContent = message;
  }
  if (elements.panel) {
    if (tone) {
      elements.panel.dataset.tone = tone;
    } else {
      delete elements.panel.dataset.tone;
    }
  }
  if (elements.button) {
    elements.button.disabled = disabled;
  }
  if (elements.buttonLabel) {
    elements.buttonLabel.textContent = !disabled && button === "認証する" ? DEFAULT_VERIFY_BUTTON_LABEL : button;
  }
}
