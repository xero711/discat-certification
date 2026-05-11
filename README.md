# Discat Guard Certification

GitHub Pagesで配信するDiscat Guardの認証ページです。

## URL

```text
https://xero-x.me/discat-certification/?token=...&apiBase=https://guard-api.xero-x.me
```

`apiBase` を省略した場合は `https://guard-api.xero-x.me` を使います。

## Discord OAuth2 Redirect

Discord Developer Portal の Discat Guard アプリケーションで、OAuth2 の Redirects に次を完全一致で追加してください。

```text
https://xero-x.me/discat-certification/
```

認証ページは `identify` スコープでDiscordへ移動し、戻ってきた `code` をGuard APIの `/verify/oauth/complete` に送ります。Client Secret はGitHub Pagesには置かず、Guard API側の `config.py` だけで使います。

## Guard側設定

`config.py` の公開URLをこのページに向けます。

```python
VERIFICATION_PUBLIC_BASE_URL = "https://xero-x.me/discat-certification/"
VERIFICATION_API_PUBLIC_BASE_URL = "https://guard-api.xero-x.me"
VERIFICATION_OAUTH_REDIRECT_URL = "https://xero-x.me/discat-certification/"
```

Guard API側のCORS許可Originには `https://xero-x.me` を含めてください。
Cloudflare Tunnelなどで `https://guard-api.xero-x.me` を Guard API の `http://127.0.0.1:8788` へ向けてください。
