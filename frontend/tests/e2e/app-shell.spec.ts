import { expect, test } from '@playwright/test'

test('keeps the sidebar footer pinned while the main panel scrolls and supports collapse', async ({ page }) => {
  await page.goto('/app-shell-harness.html')

  await expect(page.getByRole('heading', { name: 'New Trip' })).toBeVisible()

  const sidebar = page.getByTestId('app-shell-sidebar')
  const sidebarFooter = page.getByTestId('app-shell-sidebar-footer')
  const content = page.getByTestId('app-shell-content')
  const sidebarState = sidebar.locator('xpath=..')

  const expandedBox = await sidebar.boundingBox()
  const footerBefore = await sidebarFooter.boundingBox()

  await content.evaluate((element) => {
    element.scrollTop = element.scrollHeight
  })

  const scrollTop = await content.evaluate((element) => element.scrollTop)
  const footerAfter = await sidebarFooter.boundingBox()

  expect(scrollTop).toBeGreaterThan(0)
  expect(expandedBox).not.toBeNull()
  expect(footerBefore).not.toBeNull()
  expect(footerAfter).not.toBeNull()
  expect(Math.abs(footerAfter!.y - footerBefore!.y)).toBeLessThan(2)

  await page.locator('[data-sidebar="trigger"]').click()
  await expect(sidebarState).toHaveAttribute('data-collapsible', 'icon')

  const collapsedBox = await sidebar.boundingBox()

  expect(collapsedBox).not.toBeNull()
  expect(collapsedBox!.width).toBeLessThan(expandedBox!.width)
})

test('opens the mobile sidebar as a shadcn sheet', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app-shell-harness.html')

  await expect(page.locator('[data-sidebar="sidebar"][data-mobile="true"]')).toHaveCount(0)

  await page.locator('[data-sidebar="trigger"]').click()

  const mobileSidebar = page.locator('[data-sidebar="sidebar"][data-mobile="true"]')

  await expect(mobileSidebar).toBeVisible()
  await expect(mobileSidebar.getByText('Voyager User')).toBeVisible()
  await expect(mobileSidebar.getByText('voyager_user@example.com')).toBeVisible()
  await expect(mobileSidebar.getByRole('link', { name: 'New Trip' })).toBeVisible()
})
