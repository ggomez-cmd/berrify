import { Delete } from "lucide-react";
import { cn } from "../../lib/cn";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "back", "0", "enter"] as const;

export function PinPad({
  pin,
  maxLength,
  disabled,
  onDigit,
  onBackspace,
  onSubmit,
}: {
  pin: string;
  maxLength: number;
  disabled?: boolean;
  onDigit: (digit: string) => void;
  onBackspace: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {KEYS.map((key) => {
        if (key === "back") {
          return (
            <button
              key={key}
              type="button"
              disabled={disabled}
              aria-label="Backspace"
              onClick={onBackspace}
              className={cn(
                "grid h-16 place-items-center rounded-2xl border border-line bg-white text-ink shadow-sm",
                "hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              <Delete className="size-6" />
            </button>
          );
        }
        if (key === "enter") {
          return (
            <button
              key={key}
              type="button"
              disabled={disabled || pin.length < 4}
              onClick={onSubmit}
              className={cn(
                "grid h-16 place-items-center rounded-2xl bg-wine text-base font-semibold text-white shadow-sm",
                "hover:bg-wine-deep disabled:cursor-not-allowed disabled:opacity-50",
              )}
            >
              Enter
            </button>
          );
        }
        return (
          <button
            key={key}
            type="button"
            disabled={disabled || pin.length >= maxLength}
            onClick={() => onDigit(key)}
            className={cn(
              "grid h-16 place-items-center rounded-2xl border border-line bg-white text-2xl font-semibold text-ink shadow-sm",
              "hover:bg-paper disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {key}
          </button>
        );
      })}
    </div>
  );
}
