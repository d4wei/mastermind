import { useState } from 'react'

/**
 * A submission's refusal shown in place of the draft verdict while the inputs it was judged on
 * stand. `draft` is the verdict of the current inputs; `refuse` records a refusal with the inputs it
 * judged, and a change to any of them returns to the draft.
 */
export function useStandingRefusal<T>(draft: T, inputs: readonly unknown[]): {
  value: T
  refuse: (value: T, judged: readonly unknown[]) => void
} {
  const [standing, setStanding] = useState<{ value: T; inputs: readonly unknown[] } | null>(null)
  const stands = standing !== null && standing.inputs.length === inputs.length &&
    standing.inputs.every((input, i) => Object.is(input, inputs[i]))
  return { value: stands ? standing.value : draft, refuse: (value, judged) => setStanding({ value, inputs: judged }) }
}
