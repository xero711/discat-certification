"use strict";

const DEFAULT_API_BASE_URL = "https://guard-api.xero-x.me";
const API_BASE_STORAGE_KEY = "discat_guard_certification_api_base";

const elements = {
  statusLabel: document.querySelector("[data-status-label]"),
  panel: document.querySelector("[data-state-panel]"),
  title: document.querySelector("[data-state-title]"),
  message: document.querySelector("[data-state-message]"),
  button: document.querySelector("[data-verify-button]"),
  buttonLabel: document.querySelector("[data-button-label]"),
};

const params = new URLSearchParams(window.location.search);
const token = String(params.get("token") ?? "").trim();
const apiBase = resolveApiBase();

boot();

function boot() {
  if (!token) {
    setState({
      status: "リンクエラー",
      title: "認証リンクが不足しています",
      message: "Discordの認証ボタンから開いた専用リンクを使用してください。",
      tone: "error",
      disabled: true,
      button: "認証できません",
    });
    return;
  }

  if (!apiBase) {
    setState({
      status: "設定エラー",
      title: "Guard API URLが未設定です",
      message: "認証ページのAPI Base URL設定を確認してください。",
      tone: "error",
      disabled: true,
      button: "認証できません",
    });
    return;
  }

  elements.button?.addEventListener("click", () => {
    void completeVerification();
  });
}

async function completeVerification() {
  setState({
    status: "認証中",
    title: "認証を処理しています",
    message: "この画面を閉じずに少しお待ちください。",
    disabled: true,
    button: "認証中",
  });

  try {
    const response = await fetch(`${apiBase}/verify/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        token,
        device: devicePayload(),
      }),
      cache: "no-store",
      credentials: "omit",
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) {
      throw new Error(verificationErrorMessage(response.status, payload));
    }

    const duplicate = Boolean(payload.duplicate_detected);
    setState({
      status: duplicate ? "重複検知" : "認証完了",
      title: duplicate ? "認証を記録しました" : "認証が完了しました",
      message: duplicate
        ? "同じ端末情報の別アカウントが検出されました。管理者へ通知されます。Discordへ戻ってください。"
        : "Discord側でロール付与を実行しました。Discordへ戻ってください。",
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
      button: "もう一度認証する",
    });
  }
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

  try {
    const stored = cleanApiBase(window.localStorage.getItem(API_BASE_STORAGE_KEY));
    if (stored) {
      return stored;
    }
  } catch {
    // Fall back to the compiled default.
  }

  return cleanApiBase(DEFAULT_API_BASE_URL);
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
    already_completed: "この認証リンクはすでに使用済みです。",
    missing_token: "認証トークンが送信されていません。",
  };
  if (messages[error]) {
    return messages[error];
  }
  if (typeof payload?.message === "string" && payload.message.trim()) {
    return payload.message;
  }
  if (status === 0) {
    return "Guard APIに接続できませんでした。API URLとCloudflare Tunnelを確認してください。";
  }
  return `Guard APIへのリクエストに失敗しました。HTTP ${status}`;
}

function connectionErrorMessage(error) {
  const message = error instanceof Error ? error.message : "";
  if (!message || message === "Failed to fetch" || message.includes("NetworkError")) {
    return "Guard APIに接続できませんでした。API URL、Cloudflare Tunnel、CORS許可Originを確認してください。";
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
