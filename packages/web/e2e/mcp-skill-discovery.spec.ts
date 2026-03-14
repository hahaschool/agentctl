import { test } from '@playwright/test';

// ---------------------------------------------------------------------------
// MCP & Skill Discovery E2E Tests
//
// These tests cover the auto-discovery picker UX in agent create and edit
// flows. They require:
//   - Control plane running on port 8080
//   - Worker running on port 9000 (with real machine registered)
//   - At least one machine with MCP servers / skills discoverable
//
// Related: runtime-selector.spec.ts covers runtime switching and model
// dropdown behavior. This file focuses on the MCP picker and skill picker
// integration specifically.
// ---------------------------------------------------------------------------

test.describe('MCP & Skill Discovery', () => {
  // -------------------------------------------------------------------------
  // Test 1: Create agent flow — MCP picker shows discovered servers
  // -------------------------------------------------------------------------

  test('create agent shows MCP picker with discovered servers', async ({ page }) => {
    await page.goto('/agents');

    // 1. Open create agent dialog
    //    - Click "Create Agent" button
    //    - Fill in required fields: name, machineId, projectPath

    // 2. Expand the "Advanced" section in the create dialog

    // 3. Verify the "MCP Servers" collapsible section is visible
    //    - Click to expand it
    //    - Wait for the "Scanning for MCP servers..." loading state to appear
    //    - Wait for server rows to render (discovered from machine config)

    // 4. Verify discovered servers have source badges (e.g. "project", "machine default")
    //    - Each server row should show a checkbox + name + badge

    // 5. Toggle some servers off (uncheck)
    //    - Verify the unchecked server shows "excluded" badge and strikethrough styling
    //    - Verify the enabled count in the section header updates

    // 6. Save the agent
    //    - Click "Create" button
    //    - Wait for dialog to close / success toast

    // 7. Verify agent config persisted correctly
    //    - GET /api/agents/:id
    //    - Assert config.mcpOverride.excluded contains the toggled-off server names
    //    - Assert config.mcpOverride.custom is empty (no custom servers added)

    test.skip(true, 'E2E stub — requires running backend with discoverable MCP servers');
  });

  // -------------------------------------------------------------------------
  // Test 2: Edit agent flow — MCP tab uses picker, not manual form
  // -------------------------------------------------------------------------

  test('edit agent MCP tab shows McpServerPicker instead of manual form', async ({ page }) => {
    await page.goto('/agents');

    // 1. Navigate to an existing agent's settings page
    //    - Click on agent row or "Settings" action
    //    - Wait for agent settings tabs to load

    // 2. Click the "MCP Servers" tab
    //    - Verify the McpServersTab component renders
    //    - Verify the description text: "MCP servers discovered from machine config"

    // 3. Verify the picker is shown (not a manual JSON/form editor)
    //    - Expand the "MCP Servers" collapsible picker section
    //    - Verify server rows appear with checkboxes and source badges
    //    - Verify the "Refresh" button is available
    //    - Verify the "+ Custom Server" button is available

    // 4. Modify overrides
    //    - Toggle one discovered server off (exclude it)
    //    - Click "+ Custom Server" to open the inline form
    //    - Fill in custom server name + command
    //    - Click "Add"
    //    - Verify "You have unsaved changes" indicator appears

    // 5. Save changes
    //    - Click "Save" button
    //    - Wait for success toast: "MCP servers saved"

    // 6. Verify persistence
    //    - Reload the page
    //    - Navigate back to agent settings > MCP tab
    //    - Verify excluded server is still unchecked
    //    - Verify custom server still appears

    test.skip(true, 'E2E stub — requires running backend with at least one agent');
  });

  // -------------------------------------------------------------------------
  // Test 3: Edit agent flow — Skills tab with SkillPicker
  // -------------------------------------------------------------------------

  test('edit agent Skills tab shows SkillPicker with discovered skills', async ({ page }) => {
    await page.goto('/agents');

    // 1. Navigate to an existing agent's settings page
    //    - Click on agent row or "Settings" action

    // 2. Verify "Skills" tab is visible in the tab bar
    //    - Click the "Skills" tab
    //    - Verify the description text: "Skills discovered from machine config"

    // 3. Expand the "Skills" collapsible picker section
    //    - Wait for "Scanning for skills..." loading to resolve
    //    - Verify skill rows grouped by source: "Global", "Project"
    //    - Each skill row shows: checkbox + name + source badge + optional "invokable" badge

    // 4. Toggle a skill off
    //    - Uncheck a discovered skill
    //    - Verify "excluded" badge appears on the unchecked row
    //    - Verify "You have unsaved changes" indicator appears

    // 5. Save
    //    - Click "Save" button
    //    - Wait for success toast: "Skills saved"

    // 6. Verify persistence
    //    - GET /api/agents/:id
    //    - Assert config.skillOverride.excluded contains the excluded skill ID
    //    - Assert the UI reflects the saved state after reload

    test.skip(true, 'E2E stub — requires running backend with discoverable skills');
  });

  // -------------------------------------------------------------------------
  // Test 4: Switching runtime refreshes pickers with new discovery results
  //
  // Related: runtime-selector.spec.ts "agent settings runtime change shows
  // confirmation" covers the confirmation dialog and MCP clearing. This test
  // focuses on the picker list refreshing after a runtime switch.
  // -------------------------------------------------------------------------

  test('switching runtime refreshes picker with new discovery results', async ({ page }) => {
    await page.goto('/agents');

    // 1. Create or navigate to an agent with claude-code runtime
    //    - Via create dialog or existing agent settings > General tab

    // 2. Open MCP Servers section in the create dialog or settings MCP tab
    //    - Expand the picker
    //    - Wait for discovery to complete
    //    - Note the server names and source badges (should reflect Claude Code config sources)
    //    - e.g., servers from ~/.claude.json or .mcp.json

    // 3. Switch runtime to codex
    //    - In create dialog: change runtime dropdown to "codex"
    //    - In edit flow: go to General tab, change runtime, confirm the prompt
    //    - (runtime-selector.spec.ts covers the confirmation dialog details)

    // 4. Go back to MCP Servers section
    //    - Verify the picker triggers a new discovery request
    //    - Verify "Scanning for MCP servers..." loading state appears briefly
    //    - Verify the server list updates with Codex-specific sources
    //    - e.g., servers from codex TOML config instead of Claude JSON config

    // 5. Verify Skills section also refreshes
    //    - Open Skills picker
    //    - Verify skills are re-fetched for the new runtime
    //    - Codex may have a different set of discovered skills than Claude Code

    // 6. Verify previous exclusions are reset
    //    - Since runtime changed, the mcpOverride should be reset
    //    - All newly discovered servers should default to enabled (no exclusions)

    test.skip(true, 'E2E stub — requires running backend with both claude-code and codex runtimes');
  });
});
