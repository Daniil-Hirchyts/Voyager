import { cn } from '@/shared/lib/cn';

type MarketingImagePlaceholderProps = {
  label?: string;
  className?: string;
};

export function MarketingImagePlaceholder({
  label = 'Image placeholder',
  className,
}: MarketingImagePlaceholderProps) {
  return (
    <div
      className={cn(
        'relative flex items-center justify-center overflow-hidden border border-white/70 bg-[linear-gradient(180deg,rgba(214,229,243,0.92),rgba(255,255,255,0.82))] text-center',
        className,
      )}
    >
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.44),transparent_48%,rgba(114,174,230,0.18))]" />
      <div className="relative rounded-full border border-white/80 bg-white/72 px-5 py-2 text-sm font-semibold tracking-[0.16em] text-slate-700 uppercase">
        {label}
      </div>
    </div>
  );
}
