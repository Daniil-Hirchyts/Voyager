import { useMemo } from "react";
import { format } from "date-fns";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";

interface TimePickerProps {
  value?: string | null;
  onChange: (value: string) => void;
  id?: string;
  placeholder?: string;
  invalid?: boolean;
  intervalMinutes?: number;
  triggerClassName?: string;
}

function formatMinutes(value: number) {
  return String(value).padStart(2, "0");
}

function buildTimeOptions(intervalMinutes: number) {
  const options: ComboboxOption[] = [];

  for (let hour = 0; hour < 24; hour += 1) {
    for (let minute = 0; minute < 60; minute += intervalMinutes) {
      const value = `${formatMinutes(hour)}:${formatMinutes(minute)}`;
      const date = new Date(2026, 0, 1, hour, minute);
      options.push({
        value,
        label: value,
        description: format(date, "h:mm a"),
        keywords: [
          format(date, "ha").toLowerCase(),
          format(date, "h:mm a").toLowerCase(),
        ],
      });
    }
  }

  return options;
}

export function TimePicker({
  value,
  onChange,
  id,
  placeholder = "Select time",
  invalid,
  intervalMinutes = 15,
  triggerClassName,
}: TimePickerProps) {
  const options = useMemo(
    () => buildTimeOptions(intervalMinutes),
    [intervalMinutes],
  );

  return (
    <Combobox
      id={id}
      value={value ?? ""}
      onValueChange={onChange}
      options={options}
      placeholder={placeholder}
      searchPlaceholder="Search time"
      emptyText="No matching times"
      invalid={invalid}
      triggerClassName={triggerClassName}
      clearLabel="Clear time"
      onClear={() => onChange("")}
    />
  );
}
