import { useState, useRef } from 'react';
import { clsx } from 'keycloakify/tools/clsx';
import type { PageProps } from 'keycloakify/login/pages/PageProps';
import type { KcContext } from '../KcContext';
import type { I18n } from '../i18n';

type RegisterKcContext = Extract<KcContext, { pageId: 'register.ftl' }>;

type Props = PageProps<RegisterKcContext, I18n> & {
  doMakeUserConfirmPassword: boolean;
};

const inputCls = (hasError: boolean) =>
  clsx(
    'w-full h-10 px-3 rounded-[10px] border bg-white text-[#1d2430] text-sm outline-none transition-all placeholder:text-[#9aa4b0]',
    hasError
      ? 'border-[rgba(196,95,79,0.55)] ring-2 ring-[rgba(196,95,79,0.1)]'
      : 'border-[rgba(91,123,159,0.22)] focus:border-[#72aee6] focus:ring-2 focus:ring-[rgba(114,174,230,0.2)]',
  );

const labelCls = 'block mb-1 text-[0.8rem] font-semibold text-[#1d2430]';

export default function Register({
  kcContext,
  i18n,
  Template,
  doUseDefaultCss,
  classes,
  doMakeUserConfirmPassword,
}: Props) {
  const { url, messagesPerField, realm, profile } = kcContext;
  const { msg, msgStr } = i18n;

  const attrValue = (name: string) => profile.attributesByName[name]?.value ?? '';

  const hasStep2Errors = messagesPerField.existsError('username', 'password', 'password-confirm');
  const [step, setStep] = useState<1 | 2>(hasStep2Errors ? 2 : 1);

  const [step1Values, setStep1Values] = useState({
    firstName: attrValue('firstName'),
    lastName: attrValue('lastName'),
    email: attrValue('email'),
  });

  const formRef = useRef<HTMLFormElement>(null);

  const handleNext = () => {
    const form = formRef.current;
    if (!form) return;
    const step1Inputs = form.querySelectorAll<HTMLInputElement>("[data-step='1']");
    let valid = true;
    for (const input of step1Inputs) {
      if (!input.reportValidity()) {
        valid = false;
        break;
      }
    }
    if (!valid) return;
    setStep1Values({
      firstName: (form.elements.namedItem('firstName') as HTMLInputElement)?.value ?? '',
      lastName: (form.elements.namedItem('lastName') as HTMLInputElement)?.value ?? '',
      email: (form.elements.namedItem('email') as HTMLInputElement)?.value ?? '',
    });
    setStep(2);
  };

  const handleBack = () => setStep(1);

  return (
    <Template
      kcContext={kcContext}
      i18n={i18n}
      doUseDefaultCss={doUseDefaultCss}
      classes={classes}
      headerNode={step === 1 ? msg('registerTitle') : msgStr('password')}
      displayInfo={false}
      displayRequiredFields={false}
    >
      <div className="mb-1 flex items-center">
        <div
          className={clsx(
            'h-1.5 w-1.5 flex-shrink-0 rounded-full transition-all duration-200',
            step >= 1 ? 'scale-125 bg-[#1a1615]' : 'bg-[rgba(91,123,159,0.22)]',
          )}
        />
        <div className="mx-1.5 h-px flex-1 bg-[rgba(91,123,159,0.14)]" />
        <div
          className={clsx(
            'h-1.5 w-1.5 flex-shrink-0 rounded-full transition-all duration-200',
            step === 2 ? 'scale-125 bg-[#1a1615]' : 'bg-[rgba(91,123,159,0.22)]',
          )}
        />
      </div>

      <form ref={formRef} action={url.registrationAction} method="post" id="kc-register-form">
        {step === 1 && (
          <div className="auth-step flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls} htmlFor="firstName">
                  {msg('firstName')} <span className="text-[#c45f4f]">*</span>
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  className={inputCls(messagesPerField.existsError('firstName'))}
                  defaultValue={step1Values.firstName}
                  required
                  autoFocus
                  autoComplete="given-name"
                  data-step="1"
                />
                {messagesPerField.existsError('firstName') && (
                  <span className="mt-0.5 block text-[0.76rem] text-[#c45f4f]">
                    {messagesPerField.getFirstError('firstName')}
                  </span>
                )}
              </div>
              <div>
                <label className={labelCls} htmlFor="lastName">
                  {msg('lastName')} <span className="text-[#c45f4f]">*</span>
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  className={inputCls(messagesPerField.existsError('lastName'))}
                  defaultValue={step1Values.lastName}
                  required
                  autoComplete="family-name"
                  data-step="1"
                />
                {messagesPerField.existsError('lastName') && (
                  <span className="mt-0.5 block text-[0.76rem] text-[#c45f4f]">
                    {messagesPerField.getFirstError('lastName')}
                  </span>
                )}
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="email">
                {msg('email')} <span className="text-[#c45f4f]">*</span>
              </label>
              <input
                id="email"
                name="email"
                type="email"
                className={inputCls(messagesPerField.existsError('email'))}
                defaultValue={step1Values.email}
                required
                autoComplete="email"
                data-step="1"
              />
              {messagesPerField.existsError('email') && (
                <span className="mt-0.5 block text-[0.76rem] text-[#c45f4f]">
                  {messagesPerField.getFirstError('email')}
                </span>
              )}
            </div>

            <div className="mt-1 flex flex-col gap-2">
              <button
                type="button"
                className="h-10 w-full cursor-pointer rounded-[10px] bg-[#1a1615] text-sm font-semibold text-white transition-all hover:bg-[#2a2422] active:translate-y-px"
                onClick={handleNext}
              >
                Continue
              </button>
              <p className="m-0 text-center text-[0.8rem] text-[#526072]">
                Already have an account?{' '}
                <a
                  href={url.loginUrl}
                  className="font-semibold text-[#1a1615] hover:text-[#2a2422]"
                >
                  {msg('doLogIn')}
                </a>
              </p>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="auth-step flex flex-col gap-3">
            <input type="hidden" name="firstName" value={step1Values.firstName} />
            <input type="hidden" name="lastName" value={step1Values.lastName} />
            <input type="hidden" name="email" value={step1Values.email} />

            {!realm.registrationEmailAsUsername && (
              <div>
                <label className={labelCls} htmlFor="username">
                  {msg('username')} <span className="text-[#c45f4f]">*</span>
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  className={inputCls(messagesPerField.existsError('username'))}
                  defaultValue={attrValue('username')}
                  required
                  autoFocus
                  autoComplete="username"
                />
                {messagesPerField.existsError('username') && (
                  <span className="mt-0.5 block text-[0.76rem] text-[#c45f4f]">
                    {messagesPerField.getFirstError('username')}
                  </span>
                )}
              </div>
            )}

            <div>
              <label className={labelCls} htmlFor="password">
                {msg('password')} <span className="text-[#c45f4f]">*</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                className={inputCls(messagesPerField.existsError('password'))}
                required
                autoComplete="new-password"
              />
              {messagesPerField.existsError('password') && (
                <span className="mt-0.5 block text-[0.76rem] text-[#c45f4f]">
                  {messagesPerField.getFirstError('password')}
                </span>
              )}
            </div>

            {doMakeUserConfirmPassword && (
              <div>
                <label className={labelCls} htmlFor="password-confirm">
                  {msg('passwordConfirm')} <span className="text-[#c45f4f]">*</span>
                </label>
                <input
                  id="password-confirm"
                  name="password-confirm"
                  type="password"
                  className={inputCls(messagesPerField.existsError('password-confirm'))}
                  required
                  autoComplete="new-password"
                />
                {messagesPerField.existsError('password-confirm') && (
                  <span className="mt-0.5 block text-[0.76rem] text-[#c45f4f]">
                    {messagesPerField.getFirstError('password-confirm')}
                  </span>
                )}
              </div>
            )}

            <div className="mt-1 flex gap-2">
              <button
                type="button"
                className="h-10 flex-shrink-0 cursor-pointer rounded-[10px] border border-[rgba(91,123,159,0.22)] bg-transparent px-4 text-sm font-semibold text-[#526072] transition-all hover:bg-[rgba(0,0,0,0.04)] active:translate-y-px"
                onClick={handleBack}
              >
                ← Back
              </button>
              <input
                type="submit"
                className="h-10 flex-1 cursor-pointer rounded-[10px] bg-[#1a1615] text-sm font-semibold text-white transition-all hover:bg-[#2a2422] active:translate-y-px"
                value={msgStr('doRegister')}
              />
            </div>
          </div>
        )}
      </form>
    </Template>
  );
}
