'use client';

import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type MutableRefObject,
  type RefObject,
} from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/shared/lib/cn';

type PromptInputContextValue = {
  isLoading: boolean;
  value: string;
  setValue: (value: string) => void;
  maxHeight: number | string;
  onSubmit?: () => void;
  disabled?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

const PromptInputContext = createContext<PromptInputContextValue>({
  isLoading: false,
  value: '',
  setValue: () => undefined,
  maxHeight: 240,
  onSubmit: undefined,
  disabled: false,
  textareaRef: { current: null } as MutableRefObject<HTMLTextAreaElement | null>,
});

function usePromptInput() {
  return useContext(PromptInputContext);
}

export type PromptInputProps = {
  isLoading?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
  maxHeight?: number | string;
  onSubmit?: () => void;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
} & React.ComponentProps<'div'>;

function assignTextareaRef(
  ref: RefObject<HTMLTextAreaElement | null> | undefined,
  element: HTMLTextAreaElement | null,
) {
  if (!ref) {
    return;
  }

  (ref as MutableRefObject<HTMLTextAreaElement | null>).current = element;
}

export function PromptInput({
  className,
  isLoading = false,
  maxHeight = 240,
  value,
  onValueChange,
  onSubmit,
  children,
  disabled = false,
  textareaRef: providedTextareaRef,
  onClick,
  ...props
}: PromptInputProps) {
  const [internalValue, setInternalValue] = useState(value || '');
  const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = providedTextareaRef ?? internalTextareaRef;

  const handleChange = (nextValue: string) => {
    setInternalValue(nextValue);
    onValueChange?.(nextValue);
  };

  const handleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (!disabled) {
      textareaRef.current?.focus();
    }
    onClick?.(event);
  };

  return (
    <TooltipProvider>
      <PromptInputContext.Provider
        value={{
          isLoading,
          value: value ?? internalValue,
          setValue: onValueChange ?? handleChange,
          maxHeight,
          onSubmit,
          disabled,
          textareaRef,
        }}
      >
        <div
          onClick={handleClick}
          className={cn(
            'transition- cursor-text rounded-[24px] border border-black/10 bg-white p-2',
            disabled && 'cursor-not-allowed opacity-70',
            className,
          )}
          {...props}
        >
          {children}
        </div>
      </PromptInputContext.Provider>
    </TooltipProvider>
  );
}

export type PromptInputTextareaProps = {
  disableAutosize?: boolean;
} & React.ComponentProps<typeof Textarea>;

export function PromptInputTextarea({
  className,
  onKeyDown,
  disableAutosize = false,
  ...props
}: PromptInputTextareaProps) {
  const { value, setValue, maxHeight, onSubmit, disabled, textareaRef } = usePromptInput();

  const adjustHeight = (element: HTMLTextAreaElement | null) => {
    if (!element || disableAutosize) {
      return;
    }

    element.style.height = 'auto';

    if (typeof maxHeight === 'number') {
      element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
      return;
    }

    element.style.height = `min(${element.scrollHeight}px, ${maxHeight})`;
  };

  const handleRef = (element: HTMLTextAreaElement | null) => {
    assignTextareaRef(textareaRef, element);
    adjustHeight(element);
  };

  useLayoutEffect(() => {
    if (!textareaRef.current || disableAutosize) {
      return;
    }
    adjustHeight(textareaRef.current);
  }, [disableAutosize, maxHeight, value, textareaRef]);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    adjustHeight(event.target);
    setValue(event.target.value);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      onSubmit?.();
    }
    onKeyDown?.(event);
  };

  return (
    <Textarea
      ref={handleRef}
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      className={cn(
        'min-h-[88px] w-full resize-none border-0 bg-transparent px-3 py-3 text-[0.92rem] leading-7 text-[var(--color-text)] outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
        className,
      )}
      rows={1}
      disabled={disabled}
      {...props}
    />
  );
}

export type PromptInputActionsProps = React.HTMLAttributes<HTMLDivElement>;

export function PromptInputActions({ children, className, ...props }: PromptInputActionsProps) {
  return (
    <div className={cn('flex items-center gap-2', className)} {...props}>
      {children}
    </div>
  );
}

export type PromptInputActionProps = {
  className?: string;
  tooltip: React.ReactNode;
  children: React.ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
} & React.ComponentProps<typeof Tooltip>;

export function PromptInputAction({
  tooltip,
  children,
  className,
  side = 'top',
  ...props
}: PromptInputActionProps) {
  const { disabled } = usePromptInput();

  return (
    <Tooltip {...props}>
      <TooltipTrigger asChild disabled={disabled} onClick={(event) => event.stopPropagation()}>
        {children}
      </TooltipTrigger>
      <TooltipContent side={side} className={className}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}
