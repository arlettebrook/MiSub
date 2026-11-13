import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

function createMemoryKV(initial = {}) {
    const store = new Map(
        Object.entries(initial).map(([key, value]) => [
            key,
            typeof value === 'string' ? value : JSON.stringify(value),
        ])
    );
    return {
        async get(key) {
            return store.has(key) ? store.get(key) : null;
        },
        async put(key, value) {
            store.set(key, value);
        },
        async delete(key) {
            store.delete(key);
        },
        async list({ prefix = '' } = {}) {
            return {
                keys: Array.from(store.keys())
                    .filter((name) => name.startsWith(prefix))
                    .map((name) => ({ name })),
            };
        },
        dump() {
            return Object.fromEntries(store);
        },
    };
}

const sampleSubscriptions = [
    {
        id: 'airport-1',
        name: '机场订阅',
        url: 'https://airport.example/sub',
        includeRules: ['HK'],
        excludeRules: ['倍率'],
    },
    { id: 'manual-1', name: '手动节点', url: 'vmess://sanitized', groups: ['manual'] },
];
const sampleProfiles = [
    {
        id: 'profile-1',
        name: '订阅组',
        subscriptions: ['airport-1'],
        manualNodes: ['manual-1'],
        ruleLevel: 'std',
    },
];
const sampleTemplates = [
    {
        id: 'tpl-1',
        name: '自定义规则',
        description: '',
        type: 'ini',
        content: '[custom]\nruleset=🎯 全球直连,[]MATCH',
        enabled: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
    },
];

function createEnv(settings = {}) {
    return {
        MISUB_KV: createMemoryKV({
            worker_settings_v1: {
                storageType: 'kv',
                mytoken: 'auto',
                webdavBackup: {
                    enabled: true,
                    endpoint: 'https://dav.example/remote.php/dav/files/user',
                    username: 'user',
                    password: 'secret',
                    remotePath: '/MiSub',
                    backupScope: 'dataOnly',
                },
                adminPassword: 'should-not-export',
                cookieSecret: 'should-not-export',
                ...settings,
            },
            misub_subscriptions_v1: sampleSubscriptions,
            misub_profiles_v1: sampleProfiles,
            misub_rule_templates_v1: sampleTemplates,
            unrelated_key: { keep: true },
        }),
    };
}

describe('WebDAV backup payload and restore', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    it('builds data-only payload with complete business collections but without settings', async () => {
        const { buildBackupPayload } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const payload = await buildBackupPayload(createEnv(), {
            scope: 'dataOnly',
            trigger: 'manual',
        });

        expect(payload.app).toBe('MiSub');
        expect(payload.type).toBe('misub-backup');
        expect(payload.scope).toBe('dataOnly');
        expect(payload.data.subscriptions).toEqual(sampleSubscriptions);
        expect(payload.data.profiles).toEqual(sampleProfiles);
        expect(payload.data.ruleTemplates).toHaveLength(1);
        expect(payload.data.ruleTemplates[0]).toMatchObject({
            id: 'tpl-1',
            name: '自定义规则',
            type: 'ini',
            content: '[custom]\nruleset=🎯 全球直连,[]MATCH',
            enabled: true,
        });
        expect(payload.data.settings).toBeNull();
    });

    it('builds data-and-settings payload while excluding WebDAV config and runtime secrets', async () => {
        const { buildBackupPayload } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const payload = await buildBackupPayload(
            createEnv({ cronSecret: 'keep-cron-for-restore', FileName: 'MiSubTest' }),
            { scope: 'dataAndSettings' }
        );

        expect(payload.scope).toBe('dataAndSettings');
        expect(payload.data.settings.FileName).toBe('MiSubTest');
        expect(payload.data.settings.cronSecret).toBe('keep-cron-for-restore');
        expect(payload.data.settings.webdavBackup).toBeUndefined();
        expect(payload.data.settings.adminPassword).toBeUndefined();
        expect(payload.data.settings.cookieSecret).toBeUndefined();
        expect(JSON.stringify(payload)).not.toContain('secret');
        expect(JSON.stringify(payload)).not.toContain('https://dav.example');
    });

    it('restores data-only backups by replacing MiSub collections without touching settings or unknown keys', async () => {
        const { restoreBackupPayload } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const env = createEnv({ FileName: 'Before' });
        const restorePayload = {
            version: 1,
            app: 'MiSub',
            type: 'misub-backup',
            scope: 'dataOnly',
            data: {
                subscriptions: [{ id: 'new-sub', name: 'New', url: 'https://new.example/sub' }],
                profiles: [
                    {
                        id: 'new-profile',
                        name: 'New Profile',
                        subscriptions: ['new-sub'],
                        manualNodes: [],
                    },
                ],
                ruleTemplates: [{ id: 'new-tpl', name: 'New Template', content: 'rules: []' }],
                settings: null,
            },
        };

        const result = await restoreBackupPayload(env, restorePayload, { createSnapshot: false });
        const kv = env.MISUB_KV.dump();

        expect(result.success).toBe(true);
        expect(JSON.parse(kv.misub_subscriptions_v1)).toEqual(restorePayload.data.subscriptions);
        expect(JSON.parse(kv.misub_profiles_v1)).toEqual(restorePayload.data.profiles);
        expect(JSON.parse(kv.misub_rule_templates_v1)).toEqual(restorePayload.data.ruleTemplates);
        expect(JSON.parse(kv.worker_settings_v1).FileName).toBe('Before');
        expect(JSON.parse(kv.unrelated_key)).toEqual({ keep: true });
    });

    it('restores data-and-settings backups but preserves current WebDAV config', async () => {
        const { restoreBackupPayload } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const env = createEnv({ FileName: 'Before' });
        const currentWebdav = JSON.parse(env.MISUB_KV.dump().worker_settings_v1).webdavBackup;

        await restoreBackupPayload(
            env,
            {
                version: 1,
                app: 'MiSub',
                type: 'misub-backup',
                scope: 'dataAndSettings',
                data: {
                    subscriptions: [],
                    profiles: [],
                    ruleTemplates: [],
                    settings: {
                        FileName: 'Restored',
                        webdavBackup: { endpoint: 'https://old.example', password: 'old-secret' },
                        adminPassword: 'bad',
                        cookieSecret: 'bad',
                    },
                },
            },
            { createSnapshot: false }
        );

        const settings = JSON.parse(env.MISUB_KV.dump().worker_settings_v1);
        expect(settings.FileName).toBe('Restored');
        expect(settings.webdavBackup).toEqual(currentWebdav);
        expect(settings.adminPassword).toBeUndefined();
        expect(settings.cookieSecret).toBeUndefined();
    });

    it('normalizes PROPFIND hrefs relative to the configured endpoint before fetching a backup', async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(
                new Response(
                    `<?xml version="1.0"?>
        <d:multistatus xmlns:d="DAV:">
          <d:response><d:href>/remote.php/dav/files/user/MiSub/</d:href></d:response>
          <d:response><d:href>https://dav.example/remote.php/dav/files/user/MiSub/misub-backup-2026-08-09%2012-00-00.json</d:href></d:response>
        </d:multistatus>`,
                    { status: 207 }
                )
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        type: 'misub-backup',
                        version: 1,
                        scope: 'dataOnly',
                        data: {
                            subscriptions: [],
                            profiles: [],
                            ruleTemplates: [],
                            settings: null,
                        },
                    }),
                    { status: 200, headers: { 'Content-Type': 'application/json' } }
                )
            );
        vi.stubGlobal('fetch', fetchMock);

        const { listWebdavBackupFiles, fetchWebdavBackupFile } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const env = createEnv();
        const files = await listWebdavBackupFiles(env);

        expect(files).toEqual([
            {
                path: '/MiSub/misub-backup-2026-08-09 12-00-00.json',
                name: 'misub-backup-2026-08-09 12-00-00.json',
            },
        ]);

        await fetchWebdavBackupFile(env, files[0].path);

        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://dav.example/remote.php/dav/files/user/MiSub'
        );
        expect(fetchMock.mock.calls[1][0]).toBe(
            'https://dav.example/remote.php/dav/files/user/MiSub/misub-backup-2026-08-09%2012-00-00.json'
        );
    });

    it('downloads the selected remote payload without restoring or changing storage', async () => {
        const { buildBackupPayload, handleWebdavBackupDownload } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const env = createEnv();
        const payload = await buildBackupPayload(env, { scope: 'dataAndSettings' });
        payload.exportedAt = '2026-08-09T04:00:00.000Z';
        payload.extraMetadata = { keep: true };
        const before = env.MISUB_KV.dump();
        const put = vi.spyOn(env.MISUB_KV, 'put');
        const fetchMock = vi.fn().mockResolvedValue(
            new Response(JSON.stringify(payload), {
                headers: { 'Content-Type': 'application/json' },
            })
        );
        vi.stubGlobal('fetch', fetchMock);

        const response = await handleWebdavBackupDownload(
            new Request('https://misub.example/api/backup/webdav/download', {
                method: 'POST',
                body: JSON.stringify({ file: '/MiSub/misub-backup-测试 12-00-00.json' }),
            }),
            env
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ success: true, exportData: payload });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe(
            'https://dav.example/remote.php/dav/files/user/MiSub/misub-backup-%E6%B5%8B%E8%AF%95%2012-00-00.json'
        );
        expect(fetchMock.mock.calls[0][1].method).toBe('GET');
        expect(put).not.toHaveBeenCalled();
        expect(env.MISUB_KV.dump()).toEqual(before);
    });

    it.each([undefined, null, 42, '', '   '])(
        'rejects an invalid remote download file path (%j) before fetching',
        async (file) => {
            const { handleWebdavBackupDownload } =
                await import('../../functions/modules/webdav-backup-handler.js');
            const fetchMock = vi.fn();
            vi.stubGlobal('fetch', fetchMock);

            const response = await handleWebdavBackupDownload(
                new Request('https://misub.example/api/backup/webdav/download', {
                    method: 'POST',
                    body: JSON.stringify({ file }),
                }),
                createEnv()
            );

            expect(response.status).toBe(400);
            expect((await response.json()).success).toBe(false);
            expect(fetchMock).not.toHaveBeenCalled();
        }
    );

    it.each([
        new Response('Not Found', { status: 404 }),
        new Response('invalid JSON', { status: 200 }),
    ])('reports remote download failures without changing storage', async (remoteResponse) => {
        const { handleWebdavBackupDownload } =
            await import('../../functions/modules/webdav-backup-handler.js');
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(remoteResponse));
        const env = createEnv();
        const before = env.MISUB_KV.dump();

        const response = await handleWebdavBackupDownload(
            new Request('https://misub.example/api/backup/webdav/download', {
                method: 'POST',
                body: JSON.stringify({ file: '/MiSub/misub-backup.json' }),
            }),
            env
        );

        expect(response.status).toBe(400);
        expect((await response.json()).success).toBe(false);
        expect(env.MISUB_KV.dump()).toEqual(before);
    });

    it('rejects download requests using an unsupported method', async () => {
        const { handleWebdavBackupDownload } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const response = await handleWebdavBackupDownload(
            new Request('https://misub.example/api/backup/webdav/download'),
            createEnv()
        );
        expect(response.status).toBe(405);
    });

    it('formats backup filenames in UTC+8', async () => {
        const { formatBackupFilename } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const now = new Date('2026-08-10T16:30:45.000Z');

        expect(formatBackupFilename('backup-{datetime}-{date}.json', now)).toBe(
            'backup-2026-08-11-00-30-45-2026-08-11.json'
        );
    });
});

function createRetentionEnv(config = {}) {
    const defaults = JSON.parse(createEnv().MISUB_KV.dump().worker_settings_v1).webdavBackup;
    return createEnv({ webdavBackup: { ...defaults, ...config } });
}

function mockWebdavServer(entries, options = {}) {
    const files = new Map(entries.map((entry) => [entry.path, entry]));
    const prefix = '/remote.php/dav/files/user';
    const escapeXml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const fetchMock = vi.fn(async (url, init) => {
        // Match the redirect modes supported by the Cloudflare Workers runtime.
        if (init.redirect && !['follow', 'manual'].includes(init.redirect)) {
            throw new TypeError('Invalid redirect value, must be one of "follow" or "manual"');
        }
        const path = decodeURIComponent(new URL(url).pathname.slice(prefix.length));
        if (init.method === 'MKCOL') return new Response(null, { status: 405 });
        if (init.method === 'PUT') {
            if (options.uploadStatus) return new Response(null, { status: options.uploadStatus });
            if (!options.omitUploadFromList) {
                files.set(path, { path, modifiedAt: new Date().toUTCString() });
            }
            return new Response(null, { status: 201 });
        }
        if (init.method === 'PROPFIND') {
            if (options.listStatus) return new Response(null, { status: options.listStatus });
            if (options.listBody) return new Response(options.listBody, { status: 207 });
            const responses = [...files.values(), ...(options.extraEntries || [])].map((entry) => {
                const href =
                    entry.href ||
                    `${prefix}${entry.path.split('/').map(encodeURIComponent).join('/')}`;
                const properties = `${entry.modifiedAt ? `<d:getlastmodified>${entry.modifiedAt}</d:getlastmodified>` : ''}
                    ${entry.collection ? '<d:resourcetype><d:collection /></d:resourcetype>' : '<d:resourcetype />'}`;
                return `<d:response><d:href>${escapeXml(href)}</d:href>
                    <d:propstat><d:prop>${properties}</d:prop><d:status>HTTP/1.1 ${entry.status || 200} OK</d:status></d:propstat>
                    </d:response>`;
            });
            return new Response(
                `<d:multistatus xmlns:d="DAV:">${responses.join('')}</d:multistatus>`,
                { status: 207 }
            );
        }
        if (init.method === 'DELETE') {
            if (options.deleteErrors?.[path]) throw new Error(options.deleteErrors[path]);
            const status = options.deleteStatuses?.[path] || 204;
            if ([200, 204, 404, 410].includes(status)) files.delete(path);
            const location = options.deleteLocations?.[path];
            return new Response(null, { status, headers: location ? { Location: location } : {} });
        }
        throw new Error(`Unexpected WebDAV request: ${init.method}`);
    });
    vi.stubGlobal('fetch', fetchMock);
    return {
        files,
        fetchMock,
        deletions: () =>
            fetchMock.mock.calls
                .filter(([, init]) => init.method === 'DELETE')
                .map(([url]) => decodeURIComponent(new URL(url).pathname.slice(prefix.length))),
    };
}

const oldBackup = (day, directory = '/MiSub') => ({
    path: `${directory}/misub-backup-2026-11-${String(day).padStart(2, '0')}-12-00-00.json`,
});

describe('WebDAV backup retention', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(new Date('2026-11-11T04:00:00.000Z'));
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it.each(['manual', 'lazy-cron'])(
        'keeps the latest configured number after a successful %s backup',
        async (trigger) => {
            const { performWebdavBackup } =
                await import('../../functions/modules/webdav-backup-handler.js');
            const server = mockWebdavServer([
                oldBackup(9),
                oldBackup(6),
                oldBackup(10),
                oldBackup(8),
            ]);
            const env = createRetentionEnv({ retentionCount: 3 });
            const result = await performWebdavBackup(env, { trigger });

            expect(result.success).toBe(true);
            expect(result.cleanup).toMatchObject({ success: true, deleted: 2, retentionCount: 3 });
            expect([...server.files.keys()].sort()).toEqual(
                [oldBackup(9).path, oldBackup(10).path, result.file].sort()
            );
            expect(server.deletions()).toEqual([oldBackup(6).path, oldBackup(8).path]);
            expect(server.fetchMock.mock.calls.map(([, init]) => init.method)).toEqual([
                'MKCOL',
                'PUT',
                'PROPFIND',
                'DELETE',
                'DELETE',
            ]);
            const settings = JSON.parse(env.MISUB_KV.dump().worker_settings_v1);
            expect(settings.webdavBackup.lastBackupStatus).toBe('success');
            expect(settings.webdavBackup.lastBackupFile).toBe(result.file);
        }
    );

    it('orders backups by server modification time when it differs from filename order', async () => {
        const { performWebdavBackup } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const olderName = { ...oldBackup(1), modifiedAt: 'Tue, 10 Nov 2026 04:00:00 GMT' };
        const newerName = { ...oldBackup(10), modifiedAt: 'Sun, 01 Nov 2026 04:00:00 GMT' };
        const server = mockWebdavServer([olderName, newerName]);
        await performWebdavBackup(createRetentionEnv({ retentionCount: 2 }));
        expect(server.deletions()).toEqual([newerName.path]);
        expect(server.files.has(olderName.path)).toBe(true);
    });

    it('keeps the uploaded file and reserves its slot if it is missing from the listing', async () => {
        const { performWebdavBackup } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const server = mockWebdavServer([oldBackup(9), oldBackup(10)], {
            omitUploadFromList: true,
        });
        const result = await performWebdavBackup(createRetentionEnv({ retentionCount: 1 }));
        expect(server.deletions()).toEqual([oldBackup(9).path, oldBackup(10).path]);
        expect(server.deletions()).not.toContain(result.file);
    });

    it.each([0, 2])(
        'does not delete when the total is within the limit (%i older files)',
        async (count) => {
            const { performWebdavBackup } =
                await import('../../functions/modules/webdav-backup-handler.js');
            const server = mockWebdavServer(
                Array.from({ length: count }, (_, index) => oldBackup(index + 1))
            );
            await performWebdavBackup(createRetentionEnv({ retentionCount: 3 }));
            expect(server.deletions()).toEqual([]);
        }
    );

    it.each([
        [undefined, 7],
        [0, 7],
        [-2, 7],
        ['invalid', 7],
        [true, 7],
        [2.8, 2],
        ['3', 3],
        [1000, 100],
    ])('normalizes the configured retention count (%j → %i)', async (configured, expected) => {
        const { performWebdavBackup } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const server = mockWebdavServer(
            Array.from({ length: 9 }, (_, index) => oldBackup(index + 1))
        );
        const result = await performWebdavBackup(
            createRetentionEnv({ retentionCount: configured })
        );
        expect(result.cleanup.retentionCount).toBe(expected);
        expect(server.files.size).toBe(Math.min(10, expected));
        expect(server.files.has(result.file)).toBe(true);
    });

    it('handles custom filename templates and includes backups using the default template', async () => {
        const { performWebdavBackup, listWebdavBackupFiles } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const directory = '/备份 & 数据';
        const customFile = { path: `${directory}/[MiSub]+-2026-11-10-12-00-00.json` };
        const legacyFile = oldBackup(9, directory);
        const unrelatedFile = { path: `${directory}/xMiSub-2026-11-08-12-00-00.json` };
        const server = mockWebdavServer([customFile, legacyFile, unrelatedFile]);
        const env = createRetentionEnv({
            remotePath: `${directory}/`,
            filenameTemplate: '[MiSub]+-{datetime}.json',
            retentionCount: 2,
        });
        const result = await performWebdavBackup(env);

        expect(server.deletions()).toEqual([legacyFile.path]);
        expect(server.files.has(unrelatedFile.path)).toBe(true);
        expect((await listWebdavBackupFiles(env)).map((file) => file.path)).toEqual([
            result.file,
            customFile.path,
        ]);
        expect(
            server.fetchMock.mock.calls.filter(([, init]) => init.method === 'DELETE')[0][1]
                .redirect
        ).toBe('manual');
    });

    it('supports backups in the endpoint root', async () => {
        const { performWebdavBackup } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const server = mockWebdavServer([oldBackup(10, '')]);
        const result = await performWebdavBackup(
            createRetentionEnv({ remotePath: '/', retentionCount: 1 })
        );
        expect(result.cleanup.success).toBe(true);
        expect(server.deletions()).toEqual([oldBackup(10, '').path]);
        expect(server.files.has(result.file)).toBe(true);
    });

    it.each(['', null])(
        'uses the default filename template when it is empty (%j)',
        async (filenameTemplate) => {
            const { performWebdavBackup } =
                await import('../../functions/modules/webdav-backup-handler.js');
            const server = mockWebdavServer([oldBackup(10)]);
            const result = await performWebdavBackup(
                createRetentionEnv({ filenameTemplate, retentionCount: 1 })
            );
            expect(result.cleanup).toMatchObject({ success: true, deleted: 1 });
            expect(server.files.has(result.file)).toBe(true);
        }
    );

    it('excludes unrelated files, collections, failed responses, and paths outside the configured directory', async () => {
        const { performWebdavBackup } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const excluded = [
            { path: '/MiSub/notes.json' },
            { path: '/MiSub/report-misub-backup-2026-11-01-12-00-00.json' },
            { ...oldBackup(1), collection: true },
            { ...oldBackup(2), status: 404 },
            oldBackup(3, '/Other'),
            oldBackup(4, '/MiSub/nested'),
            {
                ...oldBackup(5),
                href: 'https://evil.example/remote.php/dav/files/user/MiSub/misub-backup-2026-11-05-12-00-00.json',
            },
            {
                ...oldBackup(6),
                href: '/another-endpoint/MiSub/misub-backup-2026-11-06-12-00-00.json',
            },
            {
                ...oldBackup(7),
                href: '/remote.php/dav/files/user/MiSub/..%2Fmisub-backup-2026-11-07-12-00-00.json',
            },
        ];
        const server = mockWebdavServer([...excluded, oldBackup(10)], {
            extraEntries: [oldBackup(10)],
        });
        await performWebdavBackup(createRetentionEnv({ retentionCount: 1 }));
        expect(server.deletions()).toEqual([oldBackup(10).path]);
        excluded.forEach((entry) => expect(server.files.has(entry.path)).toBe(true));
    });

    it('protects backups uploaded by another request after this backup started', async () => {
        const { performWebdavBackup } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const newerFile = oldBackup(12);
        const server = mockWebdavServer([oldBackup(10), newerFile]);
        const result = await performWebdavBackup(createRetentionEnv({ retentionCount: 1 }));
        expect(server.deletions()).toEqual([oldBackup(10).path]);
        expect(server.files.has(newerFile.path)).toBe(true);
        expect(server.files.has(result.file)).toBe(true);
    });

    it('never lists or deletes old backups when uploading fails', async () => {
        const { performWebdavBackup } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const server = mockWebdavServer([oldBackup(9), oldBackup(10)], { uploadStatus: 500 });
        const env = createRetentionEnv({ retentionCount: 1 });
        await expect(performWebdavBackup(env)).rejects.toThrow('WebDAV 上传失败');
        expect(server.fetchMock.mock.calls.map(([, init]) => init.method)).toEqual([
            'MKCOL',
            'PUT',
        ]);
        expect(server.files.size).toBe(2);
        expect(
            JSON.parse(env.MISUB_KV.dump().worker_settings_v1).webdavBackup.lastBackupStatus
        ).toBe('failed');
    });

    it.each([
        { listStatus: 403 },
        { listBody: '<html>Access denied</html>' },
        { listBody: '<d:multistatus xmlns:d="DAV:"><d:response>truncated' },
    ])('keeps the uploaded backup successful if listing fails (%j)', async (options) => {
        const { performWebdavBackup } =
            await import('../../functions/modules/webdav-backup-handler.js');
        const server = mockWebdavServer([oldBackup(10)], options);
        const env = createRetentionEnv({ retentionCount: 1 });
        const result = await performWebdavBackup(env);
        expect(result.success).toBe(true);
        expect(result.cleanup.success).toBe(false);
        expect(result.message).toContain('旧备份清理失败');
        expect(server.deletions()).toEqual([]);
        expect(server.files.has(result.file)).toBe(true);
        const savedConfig = JSON.parse(env.MISUB_KV.dump().worker_settings_v1).webdavBackup;
        expect(savedConfig.lastBackupStatus).toBe('success');
        expect(savedConfig.lastBackupMessage).toBe(result.message);
    });

    it.each([403, 207, 'network'])(
        'reports deletion failures and continues cleaning other old files (%j)',
        async (failure) => {
            const { performWebdavBackup } =
                await import('../../functions/modules/webdav-backup-handler.js');
            const options =
                failure === 'network'
                    ? { deleteErrors: { [oldBackup(9).path]: 'Network unavailable' } }
                    : { deleteStatuses: { [oldBackup(9).path]: failure } };
            const server = mockWebdavServer([oldBackup(9), oldBackup(10)], options);
            const result = await performWebdavBackup(createRetentionEnv({ retentionCount: 1 }));
            expect(result.success).toBe(true);
            expect(result.cleanup).toMatchObject({ success: false, deleted: 1 });
            expect(result.cleanup.message).toContain(oldBackup(9).path.split('/').pop());
            expect(server.deletions()).toEqual([oldBackup(9).path, oldBackup(10).path]);
            expect(server.files.has(result.file)).toBe(true);
        }
    );

    it.each([404, 410])('treats already removed files as cleaned (HTTP %i)', async (status) => {
        const { performWebdavBackup } =
            await import('../../functions/modules/webdav-backup-handler.js');
        mockWebdavServer([oldBackup(10)], { deleteStatuses: { [oldBackup(10).path]: status } });
        const result = await performWebdavBackup(createRetentionEnv({ retentionCount: 1 }));
        expect(result.cleanup).toMatchObject({ success: true, deleted: 1 });
    });

    it.each([301, 302, 303, 307, 308])(
        'does not follow a redirected deletion or count it as cleaned (HTTP %i)',
        async (status) => {
            const { performWebdavBackup } =
                await import('../../functions/modules/webdav-backup-handler.js');
            const redirectedFile = oldBackup(9);
            const location = 'https://other.example/backup.json';
            const server = mockWebdavServer([redirectedFile, oldBackup(10)], {
                deleteStatuses: { [redirectedFile.path]: status },
                deleteLocations: { [redirectedFile.path]: location },
            });
            const env = createRetentionEnv({ retentionCount: 1 });
            const result = await performWebdavBackup(env);

            expect(result.success).toBe(true);
            expect(result.cleanup).toMatchObject({ success: false, deleted: 1 });
            expect(result.cleanup.message).toContain(`HTTP ${status}`);
            expect(server.files.has(redirectedFile.path)).toBe(true);
            expect(server.files.has(result.file)).toBe(true);
            expect(server.files.has(oldBackup(10).path)).toBe(false);
            expect(server.deletions()).toEqual([redirectedFile.path, oldBackup(10).path]);
            const deleteCalls = server.fetchMock.mock.calls.filter(
                ([, init]) => init.method === 'DELETE'
            );
            expect(deleteCalls.every(([, init]) => init.redirect === 'manual')).toBe(true);
            expect(server.fetchMock.mock.calls.some(([url]) => url === location)).toBe(false);
            const savedConfig = JSON.parse(env.MISUB_KV.dump().worker_settings_v1).webdavBackup;
            expect(savedConfig.lastBackupStatus).toBe('success');
            expect(savedConfig.lastBackupMessage).toBe(result.message);
        }
    );
});
