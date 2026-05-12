"use strict";

const DEFAULT_API_BASE_URL = "https://guard-api.xero-x.me";
const DISCORD_CLIENT_ID = "1503177107910561954";
const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
const API_BASE_STORAGE_KEY = "discat_guard_certification_api_base";
const PRODUCTION_ORIGIN = "https://xero-x.me";

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
};

const params = new URLSearchParams(window.location.search);
const oauthCode = String(params.get("code") ?? "").trim();
const oauthError = String(params.get("error") ?? "").trim();
const rawOauthState = String(params.get("state") ?? "").trim();
const oauthState = parseOAuthState(rawOauthState);
const token = String(params.get("token") ?? oauthState.token ?? "").trim();
const guildId = String(params.get("guild_id") ?? oauthState.guildId ?? "").trim();
const apiBase = resolveApiBase();
let buttonAction = startDiscordOAuth;

void boot();

async function boot() {
  elements.button?.addEventListener("click", () => {
    void buttonAction();
  });
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

    if (payload.already_verified) {
      window.history.replaceState({}, "", currentRedirectUri());
      showAlreadyVerified();
      return;
    }

    const duplicate = Boolean(payload.duplicate_detected);
    window.history.replaceState({}, "", currentRedirectUri());
    setState({
      status: duplicate ? "重複検知" : "認証完了",
      title: duplicate ? "認証を記録しました" : "認証が完了しました",
      message: "",
      tone: duplicate ? "warning" : "success",
      disabled: true,
      button: "完了",
    });
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
  renderServer(payload.guild);
  if (payload.already_verified) {
    showAlreadyVerified();
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

function showAlreadyVerified() {
  setState({
    status: "認証済み",
    title: "既に認証済みです。",
    message: "",
    tone: "success",
    disabled: true,
    button: "完了",
  });
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
    elements.buttonLabel.textContent = button;
  }
}
