import { Input, Select } from "../../components/ui/input";
import { accountSelectValues, type QbAccountRow } from "../../lib/qb-account-match";

export function InvoiceReviewAccountField({
  accounts,
  value,
  onChange,
  className,
  id,
  emptyLabel = "Select account",
}: {
  accounts: QbAccountRow[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
  emptyLabel?: string;
}) {
  if (accounts.length === 0) {
    return (
      <Input
        id={id}
        className={className}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <Select
      id={id}
      className={className}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {accountSelectValues(accounts, value).map((name) => (
        <option key={name} value={name}>
          {name}
        </option>
      ))}
    </Select>
  );
}
