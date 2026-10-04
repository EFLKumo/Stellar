import {
  NativeSelect,
  NativeSelectOption,
} from "@workspace/ui/components/native-select"
import type { ModelOption } from "@/shared/contracts"

export function ModelPicker({
  models,
  value,
  onChange,
  disabled = false,
}: {
  models: ModelOption[]
  value: string
  onChange: (id: string) => void
  disabled?: boolean
}) {
  return (
    <NativeSelect
      aria-label="AI model"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled || models.length === 0}
    >
      {models.length === 0 && (
        <NativeSelectOption value="">No AI model configured</NativeSelectOption>
      )}
      {models.map((model) => (
        <NativeSelectOption key={model.id} value={model.id}>
          {model.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  )
}
