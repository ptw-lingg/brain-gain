import { test, expect, type APIRequestContext } from '@playwright/test';
import { CREDS, login } from './fixtures';
import { buildScorm12, stubScoHtml } from '../../backend/tests/helpers/scormFixture.mjs';
import JSZip from 'jszip';

// E2E for the isolation boundary (SYS-SCO-05/06/12, traced to SR-178/SR-181) — the crux of the
// design. A hostile package cannot read the app token or DOM, cannot navigate the top frame, and a
// forged bridge message cannot complete a training; the signature dialog never shares the screen
// with third-party content; and both origins send the right security headers.

async function tokenFor(request: APIRequestContext, creds: { email: string; password: string }): Promise<string> {
  const res = await request.post('/api/auth/login', { data: creds });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token;
}
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

// Trainings this spec created and assigned to the member — cleaned up in afterAll so later specs
// (e.g. sessions-due) still find the seeded dashboard they expect.
const createdTrainings: string[] = [];

/** A package whose SCO tries every escape and logs the result, so the page can assert containment. */
async function buildHostilePackage(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'imsmanifest.xml',
    `<?xml version="1.0"?><manifest identifier="EVIL" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
      <metadata><schemaversion>1.2</schemaversion></metadata>
      <organizations default="O"><organization identifier="O"><title>Evil</title>
        <item identifier="I" identifierref="R"><title>Evil</title></item></organization></organizations>
      <resources><resource identifier="R" type="webcontent" adlcp:scormtype="sco" href="index.html">
        <file href="index.html"/></resource></resources></manifest>`,
  );
  zip.file(
    'index.html',
    `<!doctype html><html><body><pre id="log" data-testid="evil-log"></pre><script>
      function log(s){document.getElementById('log').textContent += s + '\\n';}
      try { log('token=' + window.localStorage.getItem('token')); } catch(e){ log('token-error:' + e.name); }
      try { log('parentdoc=' + window.parent.parent.document.title); } catch(e){ log('parentdoc-error:' + e.name); }
      try { window.top.location = 'https://example.invalid/'; log('topnav=ran'); } catch(e){ log('topnav-error:' + e.name); }
      try { window.parent.parent.postMessage({bg:'scorm',v:1,type:'terminate',nonce:'wrong',attemptId:'x',seq:999,values:{'cmi.core.lesson_status':'passed'},exit:''}, '*'); log('forged=sent'); } catch(e){ log('forged-error:' + e.name); }
    </script></body></html>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Promise<Buffer>;
}

async function makeAssignedScorm(request: APIRequestContext, bytes: Buffer): Promise<string> {
  const adminToken = await tokenFor(request, CREDS.admin);
  const pkgRes = await request.post('/api/trainings/scorm-packages?name=c.zip', {
    headers: { ...auth(adminToken), 'content-type': 'application/octet-stream' },
    data: bytes,
  });
  const packageId = (await pkgRes.json()).packageId;
  const created = await request.post('/api/trainings', { headers: auth(adminToken), data: { name: `E2E SCORM Iso ${Date.now()}` } });
  const trainingId = (await created.json()).id;
  await request.put(`/api/trainings/${trainingId}`, { headers: auth(adminToken), data: { scormPackageId: packageId } });
  await request.post(`/api/trainings/${trainingId}/publish-update`, { headers: auth(adminToken), data: { kind: 'silent' } });
  const roles = await (await request.get('/api/roles', { headers: auth(adminToken) })).json();
  const lab = roles.find((r: { name: string }) => r.name === 'Lab Technician');
  await request.put(`/api/roles/${lab.id}`, {
    headers: auth(adminToken),
    data: { name: lab.name, description: '', trainingIds: [...lab.trainingIds, trainingId] },
  });
  createdTrainings.push(trainingId);
  return trainingId;
}

test.describe('SCORM isolation boundary', () => {
  test.afterAll(async ({ request }) => {
    const adminToken = await tokenFor(request, CREDS.admin);
    const roles = await (await request.get('/api/roles', { headers: auth(adminToken) })).json();
    const lab = roles.find((r: { name: string }) => r.name === 'Lab Technician');
    if (lab) {
      await request.put(`/api/roles/${lab.id}`, {
        headers: auth(adminToken),
        data: { name: lab.name, description: '', trainingIds: lab.trainingIds.filter((id: string) => !createdTrainings.includes(id)) },
      });
    }
    for (const id of createdTrainings) {
      await request.delete(`/api/trainings/${id}`, { headers: auth(adminToken) });
    }
  });

  test('SYS-SCO-05 / SR-178 / VT-213: hostile package JS cannot read the token or DOM, cannot navigate the top frame, and a forged message completes nothing', async ({ page, request }) => {
    const trainingId = await makeAssignedScorm(request, await buildHostilePackage());
    const memberToken = await tokenFor(request, CREDS.member);
    await login(page, 'member');
    await page.goto(`/session/${trainingId}`);
    await page.getByTestId('session-start').click();
    await expect(page.getByTestId('scorm-frame')).toBeVisible();

    const sco = page.frameLocator('[data-testid="scorm-frame"]').frameLocator('#sco');
    const log = sco.getByTestId('evil-log');
    await expect(log).toContainText('token=null'); // localStorage is origin-partitioned
    await expect(log).toContainText('parentdoc-error:'); // cross-origin document access throws
    // The app is still on the session page — the top-nav attempt was blocked by the sandbox.
    await expect(page).toHaveURL(new RegExp(`/session/${trainingId}`));
    // The app's own token is untouched.
    const appToken = await page.evaluate(() => window.localStorage.getItem('token'));
    expect(appToken).toBeTruthy();
    // The forged terminate created no session (wrong nonce, and completion needs the signature).
    const sessions = await (await request.get('/api/sessions/mine', { headers: auth(memberToken) })).json();
    expect(sessions.filter((s: { trainingId: string }) => s.trainingId === trainingId)).toHaveLength(0);
    await expect(page.getByTestId('scorm-finish')).toHaveCount(0);
  });

  test('SYS-SCO-05 / SR-178 / VT-214: the signature dialog never shares the screen with third-party content', async ({ page, request }) => {
    const trainingId = await makeAssignedScorm(request, await buildScorm12({}));
    await login(page, 'member');
    await page.goto(`/session/${trainingId}`);
    await page.getByTestId('session-start').click();

    const sco = page.frameLocator('[data-testid="scorm-frame"]').frameLocator('#sco');
    await sco.getByTestId('sco-init').click();
    await sco.getByTestId('sco-set-passed').click();
    await sco.getByTestId('sco-commit').click();
    await sco.getByTestId('sco-finish').click();
    await page.getByTestId('scorm-finish').click();

    // The moment the signature dialog is up, the frame is gone.
    await expect(page.getByTestId('signature-dialog')).toBeVisible();
    await expect(page.getByTestId('scorm-frame')).toHaveCount(0);
  });

  test('SYS-SCO-12 / SR-181 / VT-207: the app origin sends a strict CSP and refuses to be framed', async ({ request }) => {
    const res = await request.get('/');
    const csp = res.headers()['content-security-policy'];
    expect(csp).toBeTruthy();
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).toContain('frame-src https://localhost:4444');
    expect(res.headers()['x-frame-options']).toBe('DENY');
    expect(res.headers()['x-content-type-options']).toBe('nosniff');
  });

  test('SYS-SCO-12 / SR-181 / VT-208: the content origin locks egress and framing, and its sandbox matches the iframe', async ({ page, request }) => {
    // Launch to get a live token, then inspect the content response headers.
    const trainingId = await makeAssignedScorm(request, await buildScorm12({}));
    const memberToken = await tokenFor(request, CREDS.member);
    const launch = await (await request.post('/api/sessions/scorm/launch', {
      headers: auth(memberToken),
      data: { trainingId },
    })).json();
    const res = await request.get(launch.url);
    const csp = res.headers()['content-security-policy'];
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain('frame-ancestors https://localhost:4443');
    expect(csp).toContain('sandbox allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads');
    expect(res.headers()['referrer-policy']).toBe('no-referrer');
    expect(res.headers()['access-control-allow-origin']).toBeUndefined();

    // The launch token is bound to the attempt: a bent signature is refused, and the content
    // origin holds no API.
    const token = launch.url.split('/s/')[1].split('/')[0];
    const bent = launch.url.replace(`/s/${token}/`, `/s/${token}x/`);
    expect((await request.get(bent)).status()).toBe(403);
    expect((await request.get('https://localhost:4444/api/trainings')).status()).toBe(404);
    void page;
    void stubScoHtml;
  });
});
