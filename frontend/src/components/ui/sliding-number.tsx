'use client';

import { useEffect, useId } from 'react';
import { motion, motionValue, type MotionValue, useSpring, useTransform } from 'motion/react';
import useMeasure from 'react-use-measure';
import { cn } from '@/shared/lib/cn';

const TRANSITION = {
  type: 'spring',
  stiffness: 280,
  damping: 18,
  mass: 0.3,
} as const;

function Digit({ value, place }: { value: number; place: number }) {
  const valueRoundedToPlace = Math.floor(value / place) % 10;
  const initial = motionValue(valueRoundedToPlace);
  const animatedValue = useSpring(initial, TRANSITION);

  useEffect(() => {
    animatedValue.set(valueRoundedToPlace);
  }, [animatedValue, valueRoundedToPlace]);

  return (
    <span className="relative inline-block w-[1ch] overflow-x-visible overflow-y-clip leading-none tabular-nums">
      <span className="invisible">0</span>
      {Array.from({ length: 10 }, (_, index) => (
        <AnimatedDigit key={index} mv={animatedValue} number={index} />
      ))}
    </span>
  );
}

function AnimatedDigit({ mv, number }: { mv: MotionValue<number>; number: number }) {
  const uniqueId = useId();
  const [ref, bounds] = useMeasure();

  const y = useTransform(mv, (latest) => {
    if (!bounds.height) {
      return 0;
    }

    const placeValue = latest % 10;
    const offset = (10 + number - placeValue) % 10;
    let nextOffset = offset * bounds.height;

    if (offset > 5) {
      nextOffset -= 10 * bounds.height;
    }

    return nextOffset;
  });

  if (!bounds.height) {
    return (
      <span ref={ref} className="invisible absolute">
        {number}
      </span>
    );
  }

  return (
    <motion.span
      ref={ref}
      style={{ y }}
      layoutId={`${uniqueId}-${number}`}
      className="absolute inset-0 flex items-center justify-center"
      transition={TRANSITION}
    >
      {number}
    </motion.span>
  );
}

type SlidingNumberProps = {
  value: number;
  className?: string;
  padStart?: boolean;
  minimumDigits?: number;
  decimalSeparator?: string;
};

export function SlidingNumber({
  value,
  className,
  padStart = false,
  minimumDigits,
  decimalSeparator = '.',
}: SlidingNumberProps) {
  const absValue = Math.abs(value);
  const [rawIntegerPart, decimalPart] = absValue.toString().split('.');
  const integerPart = rawIntegerPart ?? '0';
  const integerValue = Number.parseInt(integerPart, 10);
  const resolvedMinimumDigits = Math.max(
    minimumDigits ?? (padStart && integerValue < 10 ? 2 : integerPart.length),
    integerPart.length,
  );
  const paddedInteger = integerPart.padStart(resolvedMinimumDigits, '0');
  const integerDigits = paddedInteger.split('');

  return (
    <span className={cn('inline-flex items-center tabular-nums', className)}>
      {value < 0 ? '-' : null}
      {integerDigits.map((_, index) => {
        const place = 10 ** (integerDigits.length - index - 1);
        return <Digit key={`integer-${place}`} value={integerValue} place={place} />;
      })}
      {decimalPart ? (
        <>
          <span>{decimalSeparator}</span>
          {decimalPart.split('').map((_, index) => (
            <Digit
              key={`decimal-${index}`}
              value={Number.parseInt(decimalPart, 10)}
              place={10 ** (decimalPart.length - index - 1)}
            />
          ))}
        </>
      ) : null}
    </span>
  );
}
