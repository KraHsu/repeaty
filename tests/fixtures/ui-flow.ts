import type { Locator } from '@playwright/test'

/** Select a real, portalled Nuxt UI option by its public field value or label. */
export async function selectUiValue(control: Locator, value: string | { label: string }) {
  await control.click()
  const options = control.page().getByRole('option')
  const target =
    typeof value === 'string'
      ? options.filter({
          has: control.page().locator(`[data-select-value=${JSON.stringify(value)}]`),
        })
      : control.page().getByRole('option', { name: value.label, exact: true })
  await target.click()
}
