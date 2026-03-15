import { useEffect } from "react";
import { clsx } from "keycloakify/tools/clsx";
import { kcSanitize } from "keycloakify/lib/kcSanitize";
import type { TemplateProps } from "keycloakify/login/TemplateProps";
import { getKcClsx } from "keycloakify/login/lib/kcClsx";
import { useSetClassName } from "keycloakify/tools/useSetClassName";
import { useInitialize } from "keycloakify/login/Template.useInitialize";
import type { I18n } from "./i18n";
import type { KcContext } from "./KcContext";

export default function Template(props: TemplateProps<KcContext, I18n>) {
    const {
        displayInfo = false,
        displayMessage = true,
        displayRequiredFields = false,
        headerNode,
        socialProvidersNode = null,
        infoNode = null,
        documentTitle,
        bodyClassName,
        kcContext,
        i18n,
        doUseDefaultCss,
        classes,
        children
    } = props;

    const { kcClsx } = getKcClsx({ doUseDefaultCss, classes });
    const { msg, msgStr, currentLanguage, enabledLanguages } = i18n;
    const { realm, auth, url, message, isAppInitiatedAction } = kcContext;

    useEffect(() => {
        document.title = documentTitle ?? msgStr("loginTitle", realm.displayName || realm.name);
    }, []);

    useSetClassName({ qualifiedName: "html", className: kcClsx("kcHtmlClass") });
    useSetClassName({
        qualifiedName: "body",
        className: clsx(bodyClassName ?? kcClsx("kcBodyClass"), "voyager-login-body")
    });

    const { isReadyToRender } = useInitialize({ kcContext, doUseDefaultCss });
    if (!isReadyToRender) return null;

    return (
        <div className="min-h-screen flex items-center justify-center p-4">
            {/* Hidden header required by Keycloak */}
            <div id="kc-header" aria-hidden="true" className="hidden">
                <div id="kc-header-wrapper">
                    {msg("loginTitleHtml", realm.displayNameHtml || realm.name)}
                </div>
            </div>

            {/* Card */}
            <div className="w-full max-w-[420px]">
                <div className="auth-card rounded-[20px] border border-white/70 bg-white shadow-[0_20px_60px_-10px_rgba(31,52,75,0.18)] overflow-hidden">
                    <div className="flex flex-col gap-5 p-5">

                        {/* Top bar: back link + brand + locale */}
                        <div className="flex items-center justify-between pb-4 border-b border-[rgba(97,126,158,0.1)]">
                            <div className="flex items-center gap-3.5">

                                <a
                                    href="http://localhost:5173"
                                    className="inline-flex items-center gap-2 text-[#1d2430]"
                                >
                                    <span className="inline-flex w-[1.875rem] h-[1.875rem] items-center justify-center rounded-[7px] bg-[#1d2430] text-white flex-shrink-0">
                                        <svg className="w-4 h-4" viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg">
                                            <path d="M60 15L15 100H42L60 62L78 100H105L60 15Z" fill="currentColor" opacity="0.96" />
                                            <path d="M60 62L42 100H78L60 62Z" fill="currentColor" opacity="0.4" />
                                        </svg>
                                    </span>
                                    <span className="text-[0.95rem] font-bold tracking-[-0.035em]">Voyager</span>
                                </a>
                            </div>

                            {enabledLanguages.length > 1 && (
                                <div className="relative" id="kc-locale">
                                    <div id="kc-locale-wrapper">
                                        <div id="kc-locale-dropdown" className="menu-button-links">
                                            <button
                                                tabIndex={1}
                                                id="kc-current-locale-link"
                                                aria-label={msgStr("languages")}
                                                aria-haspopup="true"
                                                aria-expanded="false"
                                                aria-controls="language-switch1"
                                                className="inline-flex items-center h-7 px-2.5 border border-[rgba(91,123,159,0.2)] rounded-full bg-white/80 text-[#1d2430] text-[0.76rem] font-semibold cursor-pointer outline-none"
                                            >
                                                {currentLanguage.label}
                                            </button>
                                            <ul
                                                role="menu"
                                                tabIndex={-1}
                                                aria-labelledby="kc-current-locale-link"
                                                aria-activedescendant=""
                                                id="language-switch1"
                                                className={kcClsx("kcLocaleListClass")}
                                            >
                                                {enabledLanguages.map(({ languageTag, label, href }, i) => (
                                                    <li key={languageTag} role="none">
                                                        <a
                                                            role="menuitem"
                                                            id={`language-${i + 1}`}
                                                            href={href}
                                                            className="block px-2.5 py-1.5 rounded-lg text-[0.82rem] text-[#1d2430] hover:bg-[rgba(47,111,115,0.08)]"
                                                        >
                                                            {label}
                                                        </a>
                                                    </li>
                                                ))}
                                            </ul>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Page title */}
                        <div className="flex flex-col gap-1">
                            {displayRequiredFields && (
                                <p className="text-[0.76rem] font-medium text-[#7b8796] m-0 mb-1">
                                    <span className="text-[#c45f4f]">*</span> {msg("requiredFields")}
                                </p>
                            )}
                            {!(auth !== undefined && auth.showUsername && !auth.showResetCredentials) ? (
                                <h1 className="m-0 text-[1.375rem] font-bold leading-tight tracking-[-0.04em] text-[#1d2430]">
                                    {headerNode}
                                </h1>
                            ) : (
                                <>
                                    <div className="flex items-center justify-between gap-2 px-3 py-2 mb-1 rounded-[10px] border border-[rgba(91,123,159,0.2)] bg-[rgba(114,174,230,0.1)] text-[0.84rem]">
                                        <span className="text-[#1a1615] font-semibold">{auth.attemptedUsername}</span>
                                        <a href={url.loginRestartFlowUrl} aria-label={msgStr("restartLoginTooltip")} className="text-[#526072] text-[0.78rem]">
                                            {msg("restartLoginTooltip")}
                                        </a>
                                    </div>
                                    <h1 className="m-0 text-[1.375rem] font-bold leading-tight tracking-[-0.04em] text-[#1d2430]">
                                        {headerNode}
                                    </h1>
                                </>
                            )}
                        </div>

                        {/* Form content */}
                        <div id="kc-content">
                            <div id="kc-content-wrapper">

                                {displayMessage && message !== undefined && (message.type !== "warning" || !isAppInitiatedAction) && (
                                    <div className={clsx(
                                        "flex items-start gap-2 px-3 py-2.5 rounded-[10px] text-[0.84rem] mb-4",
                                        `alert-${message.type}`,
                                        kcClsx("kcAlertClass"),
                                        `pf-m-${message.type === "error" ? "danger" : message.type}`
                                    )}>
                                        <div className="pf-c-alert__icon flex-shrink-0 mt-px">
                                            {message.type === "success" && <span className={kcClsx("kcFeedbackSuccessIcon")} />}
                                            {message.type === "warning" && <span className={kcClsx("kcFeedbackWarningIcon")} />}
                                            {message.type === "error" && <span className={kcClsx("kcFeedbackErrorIcon")} />}
                                            {message.type === "info" && <span className={kcClsx("kcFeedbackInfoIcon")} />}
                                        </div>
                                        <span
                                            className="pf-c-alert__title"
                                            dangerouslySetInnerHTML={{ __html: kcSanitize(message.summary) }}
                                        />
                                    </div>
                                )}

                                {children}

                                {auth !== undefined && auth.showTryAnotherWayLink && (
                                    <form id="kc-select-try-another-way-form" action={url.loginAction} method="post">
                                        <div className="mt-3">
                                            <input type="hidden" name="tryAnotherWay" value="on" />
                                            <a
                                                href="#"
                                                id="try-another-way"
                                                onClick={event => {
                                                    const form = event.currentTarget.closest("form");
                                                    if (form instanceof HTMLFormElement) form.requestSubmit();
                                                    event.preventDefault();
                                                    return false;
                                                }}
                                            >
                                                {msg("doTryAnotherWay")}
                                            </a>
                                        </div>
                                    </form>
                                )}

                                {socialProvidersNode}

                                {displayInfo && (
                                    <div id="kc-info" className="mt-4 pt-4 border-t border-[rgba(97,126,158,0.1)]">
                                        <div id="kc-info-wrapper" className="text-center text-[0.8rem] text-[#526072]">
                                            {infoNode}
                                        </div>
                                    </div>
                                )}

                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}
