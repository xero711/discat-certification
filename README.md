# Discat Guard Certification

GitHub Pagesで配信するDiscat Guardの認証ページです。

## URL

```text
https://xero-x.me/discat-certification/?token=...&apiBase=https://guard-api.xero-x.me
```

`apiBase` を省略した場合は `https://guard-api.xero-x.me` を使います。

## Guard側設定

`config.py` の公開URLをこのページに向けます。

```python
VERIFICATION_PUBLIC_BASE_URL = "https://xero-x.me/discat-certification/"
VERIFICATION_API_PUBLIC_BASE_URL = "https://guard-api.xero-x.me"
```

Guard API側のCORS許可Originには `https://xero-x.me` を含めてください。
