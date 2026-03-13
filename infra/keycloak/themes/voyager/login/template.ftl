<#import "footer.ftl" as loginFooter>
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html class="${properties.kcHtmlClass!}"<#if realm.internationalizationEnabled> lang="${locale.currentLanguageTag}" dir="${(locale.rtl)?then('rtl','ltr')}"</#if>>

<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">

    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>
    <title>${msg("loginTitle",(realm.displayName!''))}</title>
    <link rel="icon" type="image/svg+xml" href="${url.resourcesPath}/img/favicon.svg" />
    <#if properties.stylesCommon?has_content>
        <#list properties.stylesCommon?split(' ') as style>
            <link href="${url.resourcesCommonPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.scripts?has_content>
        <#list properties.scripts?split(' ') as script>
            <script src="${url.resourcesPath}/${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="importmap">
        {
            "imports": {
                "rfc4648": "${url.resourcesCommonPath}/vendor/rfc4648/rfc4648.js"
            }
        }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        import { startSessionPolling } from "${url.resourcesPath}/js/authChecker.js";

        startSessionPolling(
          "${url.ssoLoginInOtherTabsUrl?no_esc}"
        );
    </script>
</head>

<body class="${properties.kcBodyClass!} ${bodyClass}">
<div class="${properties.kcLoginClass!} voyager-auth-shell">
    <div class="voyager-auth-backdrop" aria-hidden="true">
        <div class="voyager-auth-cloud voyager-auth-cloud-one"></div>
        <div class="voyager-auth-cloud voyager-auth-cloud-two"></div>
        <div class="voyager-auth-grid"></div>
    </div>

    <div id="kc-header" class="${properties.kcHeaderClass!}" aria-hidden="true">
        <div id="kc-header-wrapper"
             class="${properties.kcHeaderWrapperClass!}">${kcSanitize(msg("loginTitleHtml",(realm.displayNameHtml!'')))?no_esc}</div>
    </div>

    <main class="voyager-auth-frame">
        <section class="${properties.kcFormCardClass!} voyager-auth-card">
            <div class="voyager-auth-card-shell">
                <div class="voyager-auth-topline">
                    <div class="voyager-auth-meta">
                        <a href="${properties.kcLogoLink!'http://localhost:5173'}" class="voyager-back-link">
                            <span class="voyager-back-link-icon">&#8592;</span>
                            <span>Back to Voyager</span>
                        </a>
                        <a href="${properties.kcLogoLink!'http://localhost:5173'}" class="voyager-auth-brand">
                            <span class="voyager-brand-mark" aria-hidden="true">
                                <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M60 15L15 100H42L60 62L78 100H105L60 15Z" fill="currentColor" opacity="0.96" />
                                    <path d="M60 62L42 100H78L60 62Z" fill="currentColor" opacity="0.4" />
                                </svg>
                            </span>
                            <span class="voyager-brand-wordmark">Voyager</span>
                        </a>
                    </div>
                    <#if realm.internationalizationEnabled && locale.supported?size gt 1>
                        <div class="${properties.kcLocaleMainClass!}" id="kc-locale">
                            <div id="kc-locale-wrapper" class="${properties.kcLocaleWrapperClass!}">
                                <div id="kc-locale-dropdown" class="menu-button-links ${properties.kcLocaleDropDownClass!}">
                                    <button tabindex="1" id="kc-current-locale-link" aria-label="${msg("languages")}" aria-haspopup="true" aria-expanded="false" aria-controls="language-switch1">${locale.current}</button>
                                    <ul role="menu" tabindex="-1" aria-labelledby="kc-current-locale-link" aria-activedescendant="" id="language-switch1" class="${properties.kcLocaleListClass!}">
                                        <#assign i = 1>
                                        <#list locale.supported as l>
                                            <li class="${properties.kcLocaleListItemClass!}" role="none">
                                                <a role="menuitem" id="language-${i}" class="${properties.kcLocaleItemClass!}" href="${l.url}">${l.label}</a>
                                            </li>
                                            <#assign i++>
                                        </#list>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </#if>
                </div>

                <header class="${properties.kcFormHeaderClass!} voyager-auth-header">
                    <#if displayRequiredFields>
                        <p class="voyager-required-note"><span class="required">*</span> ${msg("requiredFields")}</p>
                    </#if>

                    <#if auth?has_content && auth.showUsername() && !auth.showResetCredentials()>
                        <#nested "show-username">
                        <div id="kc-username" class="${properties.kcFormGroupClass!}">
                            <span id="kc-attempted-username">${auth.attemptedUsername}</span>
                            <a id="reset-login" href="${url.loginRestartFlowUrl}" aria-label="${msg("restartLoginTooltip")}">
                                <span class="voyager-reset-login-text">${msg("restartLoginTooltip")}</span>
                                <span class="voyager-reset-login-icon" aria-hidden="true">
                                    <i class="${properties.kcResetFlowIcon!}"></i>
                                </span>
                            </a>
                        </div>
                    </#if>

                    <h1 id="kc-page-title"><#nested "header"></h1>
                    <p class="voyager-auth-subtitle">Complete this secure step to continue in Voyager.</p>
                </header>

                <div id="kc-content">
                    <div id="kc-content-wrapper">
                        <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                            <div class="alert-${message.type} ${properties.kcAlertClass!} pf-m-<#if message.type = 'error'>danger<#else>${message.type}</#if>">
                                <div class="pf-c-alert__icon">
                                    <#if message.type = 'success'><span class="${properties.kcFeedbackSuccessIcon!}"></span></#if>
                                    <#if message.type = 'warning'><span class="${properties.kcFeedbackWarningIcon!}"></span></#if>
                                    <#if message.type = 'error'><span class="${properties.kcFeedbackErrorIcon!}"></span></#if>
                                    <#if message.type = 'info'><span class="${properties.kcFeedbackInfoIcon!}"></span></#if>
                                </div>
                                <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                            </div>
                        </#if>

                        <#nested "form">

                        <#if auth?has_content && auth.showTryAnotherWayLink()>
                            <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
                                <div class="${properties.kcFormGroupClass!}">
                                    <input type="hidden" name="tryAnotherWay" value="on"/>
                                    <a href="#" id="try-another-way"
                                       onclick="document.forms['kc-select-try-another-way-form'].requestSubmit();return false;">${msg("doTryAnotherWay")}</a>
                                </div>
                            </form>
                        </#if>

                        <#nested "socialProviders">

                        <#if displayInfo>
                            <div id="kc-info" class="${properties.kcSignUpClass!}">
                                <div id="kc-info-wrapper" class="${properties.kcInfoAreaWrapperClass!}">
                                    <#nested "info">
                                </div>
                            </div>
                        </#if>
                    </div>
                </div>

                <@loginFooter.content/>
            </div>
        </section>
    </main>
</div>
</body>
</html>
</#macro>
