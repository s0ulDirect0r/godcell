import { test, expect } from '@playwright/test';

test.describe('Model Viewer with lil-gui Controls', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to model-viewer page
    await page.goto('/model-viewer.html');
    // Wait for Three.js canvas to render
    await page.waitForSelector('canvas');
  });

  test('should load the model viewer page', async ({ page }) => {
    // Verify the page title or canvas exists
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('should display lil-gui panel', async ({ page }) => {
    // lil-gui creates a div with class "lil-gui"
    const guiPanel = page.locator('.lil-gui');
    await expect(guiPanel).toBeVisible();

    // Verify the title
    await expect(guiPanel.locator('.title')).toContainText('Model Viewer Controls');
  });

  test('should have Entity Selection folder', async ({ page }) => {
    const guiPanel = page.locator('.lil-gui');

    // Find the Entity Selection folder
    const entityFolder = guiPanel.locator('.folder').filter({ hasText: 'Entity Selection' });
    await expect(entityFolder).toBeVisible();

    // Should have Entity Type dropdown
    const entityTypeController = entityFolder.locator('.controller').filter({ hasText: 'Entity Type' });
    await expect(entityTypeController).toBeVisible();

    // Should have Multi-cell Style dropdown
    const styleController = entityFolder.locator('.controller').filter({ hasText: 'Multi-cell Style' });
    await expect(styleController).toBeVisible();
  });

  test('should have Animation folder with controls', async ({ page }) => {
    const guiPanel = page.locator('.lil-gui');

    // Find the Animation folder
    const animFolder = guiPanel.locator('.folder').filter({ hasText: 'Animation' });
    await expect(animFolder).toBeVisible();

    // Should have Energy % slider
    const energyController = animFolder.locator('.controller').filter({ hasText: 'Energy %' });
    await expect(energyController).toBeVisible();

    // Should have Auto Cycle Energy checkbox
    const autoCycleController = animFolder.locator('.controller').filter({ hasText: 'Auto Cycle Energy' });
    await expect(autoCycleController).toBeVisible();

    // Should have Animation Speed slider
    const speedController = animFolder.locator('.controller').filter({ hasText: 'Animation Speed' });
    await expect(speedController).toBeVisible();

    // Should have Auto Rotate checkbox
    const autoRotateController = animFolder.locator('.controller').filter({ hasText: 'Auto Rotate' });
    await expect(autoRotateController).toBeVisible();
  });

  test('should have VFX Parameters folder', async ({ page }) => {
    const guiPanel = page.locator('.lil-gui');

    // Find the VFX Parameters folder (may be closed by default)
    const vfxFolder = guiPanel.locator('.folder').filter({ hasText: 'VFX Parameters' });
    await expect(vfxFolder).toBeVisible();

    // Click to expand it if closed
    const vfxTitle = vfxFolder.locator('.title').first();
    await vfxTitle.click();

    // Should have Cell Visuals subfolder
    const cellVfxFolder = vfxFolder.locator('.folder').filter({ hasText: 'Cell Visuals' });
    await expect(cellVfxFolder).toBeVisible();

    // Should have Multi-cell subfolder
    const multiVfxFolder = vfxFolder.locator('.folder').filter({ hasText: 'Multi-cell' });
    await expect(multiVfxFolder).toBeVisible();
  });

  test('should have View Options folder with Export Params button', async ({ page }) => {
    const guiPanel = page.locator('.lil-gui');

    // Find and expand View Options folder
    const viewFolder = guiPanel.locator('.folder').filter({ hasText: 'View Options' });
    await expect(viewFolder).toBeVisible();

    // Click to expand it
    const viewTitle = viewFolder.locator('.title').first();
    await viewTitle.click();

    // Should have Wireframe checkbox
    const wireframeController = viewFolder.locator('.controller').filter({ hasText: 'Wireframe' });
    await expect(wireframeController).toBeVisible();

    // Should have Reset Camera button
    const resetCameraBtn = viewFolder.locator('.controller').filter({ hasText: 'Reset Camera' });
    await expect(resetCameraBtn).toBeVisible();

    // Should have Export Params button
    const exportBtn = viewFolder.locator('.controller').filter({ hasText: 'Export Params' });
    await expect(exportBtn).toBeVisible();
  });

  test('should change entity type via dropdown', async ({ page }) => {
    const guiPanel = page.locator('.lil-gui');
    const entityFolder = guiPanel.locator('.folder').filter({ hasText: 'Entity Selection' });

    // Find the Entity Type select element
    const entityTypeSelect = entityFolder.locator('select').first();
    await expect(entityTypeSelect).toBeVisible();

    // Change to single-cell
    await entityTypeSelect.selectOption('single-cell');

    // Wait a moment for model to update
    await page.waitForTimeout(500);

    // Change to swarm
    await entityTypeSelect.selectOption('swarm');
    await page.waitForTimeout(500);

    // Change to obstacle
    await entityTypeSelect.selectOption('obstacle');
    await page.waitForTimeout(500);

    // Canvas should still be visible (no crash)
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('should toggle auto-animate checkbox', async ({ page }) => {
    const guiPanel = page.locator('.lil-gui');
    const animFolder = guiPanel.locator('.folder').filter({ hasText: 'Animation' });

    // Find the Auto Cycle Energy checkbox
    const autoCycleController = animFolder.locator('.controller').filter({ hasText: 'Auto Cycle Energy' });
    const checkbox = autoCycleController.locator('input[type="checkbox"]');

    // Should be checked by default (autoAnimate: true)
    await expect(checkbox).toBeChecked();

    // Toggle it off
    await checkbox.click();
    await expect(checkbox).not.toBeChecked();

    // Toggle it back on
    await checkbox.click();
    await expect(checkbox).toBeChecked();
  });

  test('should adjust energy slider', async ({ page }) => {
    const guiPanel = page.locator('.lil-gui');
    const animFolder = guiPanel.locator('.folder').filter({ hasText: 'Animation' });

    // First disable auto-animate so we can control energy manually
    const autoCycleController = animFolder.locator('.controller').filter({ hasText: 'Auto Cycle Energy' });
    const autoCheckbox = autoCycleController.locator('input[type="checkbox"]');
    await autoCheckbox.click(); // Turn off auto cycle

    // Find the Energy % slider
    const energyController = animFolder.locator('.controller').filter({ hasText: 'Energy %' });
    const slider = energyController.locator('input[type="range"]');

    await expect(slider).toBeVisible();

    // Get initial value
    const initialValue = await slider.inputValue();

    // Set to a specific value by clicking on the slider
    await slider.fill('25');

    // Verify it changed
    const newValue = await slider.inputValue();
    expect(newValue).toBe('25');
  });

  test('should have original HTML buttons still functional', async ({ page }) => {
    // The original HTML buttons should still exist alongside lil-gui
    const singleCellBtn = page.locator('#single-cell');
    const multiCellBtn = page.locator('#multi-cell');
    const swarmBtn = page.locator('#swarm');

    await expect(singleCellBtn).toBeVisible();
    await expect(multiCellBtn).toBeVisible();
    await expect(swarmBtn).toBeVisible();

    // Click single-cell button
    await singleCellBtn.click();
    await page.waitForTimeout(300);

    // Click multi-cell button
    await multiCellBtn.click();
    await page.waitForTimeout(300);

    // Canvas should still work
    await expect(page.locator('canvas')).toBeVisible();
  });

  test('should render canvas without WebGL errors', async ({ page }) => {
    // Listen for console errors
    const errors: string[] = [];
    page.on('console', msg => {
      if (msg.type() === 'error') {
        errors.push(msg.text());
      }
    });

    // Wait for rendering to stabilize
    await page.waitForTimeout(2000);

    // Check for WebGL-related errors
    const webglErrors = errors.filter(e =>
      e.toLowerCase().includes('webgl') ||
      e.toLowerCase().includes('three') ||
      e.toLowerCase().includes('shader')
    );

    expect(webglErrors).toHaveLength(0);
  });
});
