import { expect, test, type Page } from "@playwright/test";
import { installTauriFixture, type TauriFixture } from "./fixtures/tauri";

const scratch = ".superpowers/sdd/2026-09-02-portpal-monochrome-redesign";

const ports = [[5173,101,"node","PortPal"],[3000,102,"node","Web App"],[4000,103,"python","API Server"],[5432,104,"postgres",null],[6379,105,"redis-server",null],[8080,106,"node","Dashboard"]].map(([port,pid,process_name,project_name]) => ({ port: port as number, pid: pid as number, process_name: process_name as string, project_name: project_name as string|null, project_path: project_name ? `C:/Projects/${project_name}` : null, protocol: "TCP", start_cmd: project_name ? "npm run dev" : null }));
const fixture: TauriFixture = {
  ports,
  events: ports.map((port,index) => ({ ...port, framework:index < 3 ? "Vite" : null, event_type:"started", timestamp:1_788_800_000_000-index*1000 })),
  traffic: Object.fromEntries(ports.map((port,index) => [port.port,[{ connections:index+1,timestamp:1_788_800_000_000 }]])),
};

async function openFixture(page: Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await installTauriFixture(page, fixture);
  await page.goto("/");
  await expect(page.getByText("6 listening ports")).toBeVisible();
}

test.describe("PortPal critical paths with deterministic Tauri data", () => {
  test("desktop shell preserves ports, inspector, navigation, logs, and settings", async ({ page }) => {
    await openFixture(page,1536,1024);
    for (const name of ["Dashboard","Ports","Traffic","Services","Logs","Settings"]) await expect(page.getByRole("navigation").getByRole("button",{name,exact:true})).toBeVisible();
    await expect(page.getByRole("navigation").getByRole("button",{name:"Port Map",exact:true})).not.toBeVisible();
    await page.getByRole("row").filter({hasText:"5173"}).click();
    await expect(page.getByRole("complementary",{name:"Port inspector for :5173"})).toBeVisible();
    await page.screenshot({path:`${scratch}/task-9-ports-1536.png`});
    await page.getByRole("button",{name:"Close inspector"}).click();
    await page.getByRole("button",{name:"Logs"}).click(); await page.getByRole("button",{name:"Refresh logs"}).click();
    await expect.poll(() => page.evaluate(() => (window as any).__PORTPAL_FIXTURE_CALLS__.filter((call:any)=>call.cmd==="get_port_events").length)).toBeGreaterThan(1);
    await page.getByRole("button",{name:"Settings"}).click(); await page.getByRole("button",{name:"Larger"}).click();
    await expect(page.locator("html")).toHaveCSS("--fs-scale","1.3");
  });

  test("compact shell scrolls and keeps inspector close operable", async ({ page }) => {
    await openFixture(page,780,480);
    await expect(page.getByRole("navigation").getByRole("button",{name:"Ports",exact:true}).locator(".shell-sidebar__label")).toHaveCSS("position","absolute");
    const tablePane=page.locator(".ports-page__table-pane"); await expect(tablePane).toHaveCSS("overflow-x","auto");
    await page.getByRole("row").filter({hasText:"5173"}).click(); await page.screenshot({path:`${scratch}/task-9-ports-780.png`}); await page.getByRole("button",{name:"Close inspector"}).click();
    await page.getByRole("button",{name:"Traffic"}).click();
    expect((await page.locator(".secondary-summary-grid").boundingBox())?.height).toBeGreaterThan(45);
    expect(await page.locator(".secondary-scroll-list").evaluate((el)=>el.scrollHeight>=el.clientHeight)).toBeTruthy();
  });
});
