<#macro emailLayout>
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Voyager Identity</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        background: #edf5fc;
        color: #1a1615;
        font-family: Outfit, "Segoe UI", Arial, sans-serif;
      }

      a {
        color: #17344c;
      }

      .voyager-email-body p {
        margin: 0 0 16px;
        color: #5a6676;
        font-size: 16px;
        line-height: 1.65;
      }

      .voyager-email-body p:last-child {
        margin-bottom: 0;
      }

      .voyager-email-body a {
        display: inline-block;
        margin-top: 8px;
        padding: 14px 20px;
        border-radius: 999px;
        background: #1a1615;
        color: #ffffff !important;
        font-weight: 600;
        text-decoration: none;
      }

      .voyager-email-body b {
        color: #1a1615;
      }

      @media (max-width: 640px) {
        .voyager-email-shell {
          border-radius: 24px !important;
        }

        .voyager-email-padding {
          padding: 24px !important;
        }
      }
    </style>
  </head>
  <body>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#edf5fc;">
      <tr>
        <td align="center" style="padding:32px 16px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;">
            <tr>
              <td style="padding:0 0 14px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="font-size:12px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#17344c;">Voyager identity</td>
                    <td align="right" style="font-size:12px;color:#7b8796;">Secure account updates and sign-in alerts</td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td class="voyager-email-shell" style="overflow:hidden;border-radius:32px;border:1px solid rgba(97,126,158,0.18);background:#ffffff;box-shadow:0 28px 68px -34px rgba(31,52,75,0.28);">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td class="voyager-email-padding" style="padding:28px 32px;background:#1a1615;">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td style="width:48px;height:48px;border-radius:16px;background:#ffffff;color:#1a1615;text-align:center;font-size:28px;font-weight:800;line-height:48px;">V</td>
                          <td style="padding-left:14px;">
                            <div style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.04em;">Voyager</div>
                            <div style="padding-top:4px;color:rgba(255,255,255,0.68);font-size:13px;">Travel identity and account security</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td class="voyager-email-padding voyager-email-body" style="padding:32px;">
                      <div style="margin-bottom:18px;color:#17344c;font-size:12px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;">Protected action</div>
                      <div style="margin:0 0 22px;color:#1a1615;font-size:30px;font-weight:700;letter-spacing:-0.05em;line-height:1.08;">
                        Keep your Voyager account moving safely.
                      </div>
                      <#nested>
                    </td>
                  </tr>
                  <tr>
                    <td class="voyager-email-padding" style="padding:24px 32px;background:#f7fbff;border-top:1px solid rgba(97,126,158,0.12);">
                      <div style="color:#5a6676;font-size:13px;line-height:1.7;">
                        If you did not expect this message, you can ignore it. Voyager will not change your account unless you complete the requested action.
                      </div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
</#macro>
