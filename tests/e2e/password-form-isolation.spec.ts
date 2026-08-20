import { expect, test } from '@playwright/test'

test('sign-in and password-reset forms never reuse credential DOM values', async ({ page }) => {
  const syntheticPassword = 'SYNTHETIC-PASSWORD-MUST-NEVER-BECOME-EMAIL'
  await page.goto('/login')
  const password = page.locator('#password')
  await password.fill(syntheticPassword)
  await password.evaluate((node) => {
    (window as typeof window & { __farmRxCredentialInput?: Element }).__farmRxCredentialInput = node
  })

  await page.getByRole('button', { name: 'Forgot password?' }).click()

  const resetEmail = page.locator('#reset-email')
  await expect(resetEmail).toBeVisible()
  await expect(resetEmail).toHaveValue('')
  expect(await resetEmail.evaluate((node) => node === (window as typeof window & { __farmRxCredentialInput?: Element }).__farmRxCredentialInput)).toBe(false)

  await resetEmail.fill('synthetic-reset@example.test')
  await resetEmail.evaluate((node) => {
    (window as typeof window & { __farmRxResetEmailInput?: Element }).__farmRxResetEmailInput = node
  })
  await page.getByRole('button', { name: 'Back to sign in' }).click()

  const returnedPassword = page.locator('#password')
  await expect(returnedPassword).toBeVisible()
  await expect(returnedPassword).toHaveValue('')
  expect(await returnedPassword.evaluate((node) => node === (window as typeof window & { __farmRxResetEmailInput?: Element }).__farmRxResetEmailInput)).toBe(false)
})
