<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="robots" content="noindex, nofollow">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Voyager Identity</title>
    <link rel="icon" type="image/svg+xml" href="${resourcesPath}/favicon.svg">
    <#if properties.stylesCommon?has_content>
      <#list properties.stylesCommon?split(' ') as style>
        <link rel="stylesheet" href="${resourcesCommonPath}/${style}">
      </#list>
    </#if>
    <#if properties.styles?has_content>
      <#list properties.styles?split(' ') as style>
        <link rel="stylesheet" href="${resourcesPath}/${style}">
      </#list>
    </#if>
  </head>
  <body class="voyager-welcome-body">
    <div class="voyager-welcome-shell">
      <div class="voyager-welcome-backdrop" aria-hidden="true">
        <div class="voyager-welcome-cloud voyager-welcome-cloud-one"></div>
        <div class="voyager-welcome-cloud voyager-welcome-cloud-two"></div>
        <div class="voyager-welcome-grid"></div>
      </div>

      <header class="voyager-welcome-header">
        <a href="http://localhost:5173" class="voyager-welcome-brand">
          <img src="${resourcesPath}/logo.svg" alt="Voyager" class="voyager-welcome-logo">
        </a>

        <div class="voyager-welcome-actions">
          <#if adminConsoleEnabled>
            <a href="${adminUrl}" class="voyager-welcome-link">Administration console</a>
          </#if>
        </div>
      </header>

      <main class="voyager-welcome-frame">
        <section class="voyager-welcome-panel">
          <div class="voyager-welcome-card">
            <#if successMessage?has_content>
              <p class="voyager-welcome-kicker">Bootstrap completed</p>
              <h2 class="voyager-welcome-title">Temporary administrator created.</h2>
              <p class="voyager-welcome-description">${successMessage}</p>
              <div class="voyager-welcome-alert voyager-welcome-alert-success">
                Open the administration console, create a permanent administrator, then remove the temporary account.
              </div>
              <a class="voyager-welcome-button" href="${adminUrl}">Open administration console</a>
            <#elseif bootstrap && localUser>
              <p class="voyager-welcome-kicker">Initial setup</p>
              <h2 class="voyager-welcome-title">Create a temporary administrative user.</h2>
              <p class="voyager-welcome-description">
                Local access is available, so you can finish the first bootstrap step here.
              </p>

              <#if errorMessage?has_content>
                <div class="voyager-welcome-alert voyager-welcome-alert-danger">${errorMessage}</div>
              </#if>

              <form method="post" class="voyager-welcome-form" novalidate>
                <label class="voyager-welcome-field">
                  <span>Username</span>
                  <input id="username" type="text" name="username" autocomplete="username" required>
                </label>

                <label class="voyager-welcome-field">
                  <span>Password</span>
                  <input id="password" type="password" name="password" autocomplete="new-password" required>
                </label>

                <label class="voyager-welcome-field">
                  <span>Password confirmation</span>
                  <input id="password-confirmation" type="password" name="passwordConfirmation" autocomplete="new-password" required>
                </label>

                <input name="stateChecker" type="hidden" value="${stateChecker}">
                <button class="voyager-welcome-button" type="submit">Create temporary admin</button>
              </form>
            <#elseif bootstrap>
              <p class="voyager-welcome-kicker">Local access required</p>
              <h2 class="voyager-welcome-title">Finish setup from the host machine.</h2>
              <p class="voyager-welcome-description">
                The bootstrap user can only be created from a local session. Open the local URL below or use the <code>bootstrap-admin</code> command.
              </p>
              <div class="voyager-welcome-alert voyager-welcome-alert-info">
                <a href="${localAdminUrl}">${localAdminUrl}</a>
              </div>
            <#else>
              <p class="voyager-welcome-kicker">Console ready</p>
              <h2 class="voyager-welcome-title">Voyager Keycloak is live.</h2>
              <p class="voyager-welcome-description">
                Open the administration console to manage realms, clients, users, and providers.
              </p>
              <#if adminConsoleEnabled>
                <a class="voyager-welcome-button" href="${adminUrl}">Open administration console</a>
              </#if>
            </#if>
          </div>
        </section>

        <aside class="voyager-welcome-story" aria-label="Setup notes">
          <div class="voyager-welcome-story-panel">
            <p class="voyager-welcome-eyebrow">Keycloak setup</p>
            <h1 class="voyager-welcome-headline">Set up secure access for Voyager.</h1>
            <p class="voyager-welcome-copy">
              This page is only for initializing or reopening the identity service.
            </p>

            <ul class="voyager-welcome-points">
              <li>Create a temporary administrator on first boot.</li>
              <li>Open the administration console to finish realm and client configuration.</li>
              <li>Replace the temporary admin with a permanent account once setup is complete.</li>
            </ul>

            <div class="voyager-welcome-story-note">
              <span>Identity service</span>
              <span>${productName}</span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  </body>
</html>
