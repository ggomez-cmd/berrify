import { cn } from "../../lib/cn";

export function BrandMark({
  className,
  title = "berrify",
}: {
  className?: string;
  title?: string;
}) {
  return (
    <span
      role="img"
      aria-label={title}
      className={cn(
        "inline-block h-8 w-[7.4rem] shrink-0 bg-current [mask-image:url(/berrify-wordmark.svg)] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] [-webkit-mask-image:url(/berrify-wordmark.svg)] [-webkit-mask-position:center] [-webkit-mask-repeat:no-repeat] [-webkit-mask-size:contain]",
        className,
      )}
    />
  );
}
