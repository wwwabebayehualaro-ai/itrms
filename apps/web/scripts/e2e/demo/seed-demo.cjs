// Fills the database with a ready-to-click demo: the three sample forms and realistic requests for each, created through the real
// API as the users who would create them (so owners, audit and permissions are real). Re-runnable.
//   E2E_API=http://localhost:8000 node seed-demo.cjs            seed (replaces the demo requests of an earlier run)
//   E2E_API=http://localhost:8000 node seed-demo.cjs --reset    remove the demo requests only (forms and your own data stay)
// Demo requests carry form_metadata.submitted_via = "demo-seed"; nothing else is ever deleted.
const fs = require('fs');
const path = require('path');
const API = (process.env.E2E_API || 'http://localhost:8765').replace(/\/$/, '');
const WEB = (process.env.E2E_WEB || 'http://localhost:3000').replace(/\/$/, '');
const PW = process.env.E2E_PASSWORD || 'Sm0ke-Test-Passw0rd';
const E2E = path.join(__dirname, '..');
const MARK = 'demo-seed';

const call = async (url, opt) => {
    for (let i = 0; ; i++) {
        try {
            return await fetch(url, opt);
        } catch (e) {
            if (i >= 3) throw e;
            await new Promise((r) => setTimeout(r, 600));
        }
    }
};
const login = async (email) => {
    const r = await call(API + '/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: PW })
    });
    if (!r.ok)
        throw new Error(`login ${email}: HTTP ${r.status} (is the tenant seeded? node ../expense-report/seed.cjs)`);
    const tok = (await r.json()).access_token;
    return { email, tok, H: { 'content-type': 'application/json', authorization: 'Bearer ' + tok } };
};
const json = async (r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${(await r.text()).slice(0, 300)}`);
    return r.json();
};

// ---- little helpers for realistic values
const round2 = (n) => Math.round(n * 100) / 100;
const day = (offset) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offset);
    return d.toISOString();
};
const rows = (list, price) => list.map(([a, b, c, d, e]) => price(a, b, c, d, e));

(async () => {
    const admin = await login('admin@acme-corp.org');
    const reset = process.argv.includes('--reset');

    // people (ids come from the tenant directory, like the form's own dropdowns)
    const directory = await json(await call(API + '/auth/directory', { headers: admin.H }));
    const person = (email) => {
        const p = directory.find((d) => d.email === email);
        if (!p) throw new Error('no user ' + email + ' (run node ../expense-report/seed.cjs)');
        return p;
    };
    const maria = person('maria.santos@acme-corp.org'),
        david = person('david.chen@acme-corp.org');
    const me = { priya: person('priya.nair@acme-corp.org'), tom: person('tom.becker@acme-corp.org'), maria };

    // ---- forms (registered once, from the templates built through the builder)
    const templates = async () => json(await call(API + '/template/forms/templates?limit=500', { headers: admin.H }));
    const have = new Set((await templates()).map((t) => t.slug));
    for (const [slug, file] of [
        ['equipment-request', 'equipment-request/equipment-request.template.json'],
        ['equipment-request-table', 'equipment-request/equipment-request-table.template.json'],
        ['expense-report', 'expense-report/expense-report.template.json'],
        ['leave-request', 'leave-request/leave-request.template.json']
    ]) {
        if (have.has(slug)) continue;
        const t = JSON.parse(fs.readFileSync(path.join(E2E, file), 'utf8'));
        await json(
            await call(API + '/template/forms/templates', { method: 'POST', headers: admin.H, body: JSON.stringify(t) })
        );
        console.log('registered form', slug);
    }
    const forms = Object.fromEntries((await templates()).map((t) => [t.slug, t]));
    if (!forms['leave-request'].category) {
        // the builder run left it uncategorised
        await call(API + '/template/forms/templates/' + forms['leave-request'].id, {
            method: 'PUT',
            headers: admin.H,
            body: JSON.stringify({ category: 'HR', row_version: forms['leave-request'].row_version })
        });
    }

    // ---- remove the demo requests of an earlier run (and their uploaded files)
    for (const slug of ['equipment-request', 'expense-report', 'leave-request']) {
        const list = await json(
            await call(API + '/form/submissions?template_id=' + forms[slug].id + '&page_size=100', { headers: admin.H })
        );
        let removed = 0;
        for (const s of list.items || []) {
            if (s.form_metadata?.submitted_via !== MARK) continue;
            for (const a of s.submission_data?.attachments || [])
                await call(API + '/files/upload/' + a.file_id, { method: 'DELETE', headers: admin.H }).catch(() => {});
            await call(API + '/form/submissions/' + s.id, { method: 'DELETE', headers: admin.H });
            removed++;
        }
        if (removed) console.log(`removed ${removed} demo request(s) of ${slug}`);
    }
    if (reset) {
        console.log('demo requests removed');
        return;
    }

    // ---- requests
    const sessions = {};
    const as = async (who) =>
        (sessions[who] ||= await login(
            who === 'maria'
                ? 'maria.santos@acme-corp.org'
                : who === 'tom'
                  ? 'tom.becker@acme-corp.org'
                  : 'priya.nair@acme-corp.org'
        ));
    const upload = async (s, name, text) => {
        const fd = new FormData();
        fd.append('file', new Blob([text], { type: 'text/plain' }), name);
        const r = await json(
            await call(API + '/files/upload', {
                method: 'POST',
                headers: { authorization: 'Bearer ' + s.tok },
                body: fd
            })
        );
        return { file_id: r.file_id, name: r.filename, size: r.size, type: r.content_type };
    };
    let n = 0;
    const submit = async (who, slug, status, data) => {
        const s = await as(who);
        await json(
            await call(API + '/form/submissions', {
                method: 'POST',
                headers: s.H,
                body: JSON.stringify({
                    template_id: forms[slug].id,
                    status,
                    submission_data: data,
                    form_metadata: { submitted_via: MARK }
                })
            })
        );
        n++;
    };

    // Equipment Request: header, repeatable items (computed totals, conditional justification above 500), files, people from the directory
    const item = (itemName, category, qty, unitPrice, justification) => ({
        itemName,
        category,
        qty,
        unitPrice,
        lineTotal: round2(qty * unitPrice),
        ...(round2(qty * unitPrice) > 500 && { justification: justification || 'Needed for the team' })
    });
    const equipment = async (who, o) => {
        const items = o.items;
        const s = await as(who);
        const attachments = o.quote ? [await upload(s, o.quote[0], o.quote[1])] : [];
        await submit(who, 'equipment-request', o.status, {
            employee:
                s.email === 'maria.santos@acme-corp.org' ? 'Maria Santos' : who === 'tom' ? 'Tom Becker' : 'Priya Nair',
            phone: o.phone,
            requestDate: day(o.date),
            manager: o.manager.id,
            approvers: o.approvers.map((p) => p.id),
            priority: o.priority,
            ...(o.priority === 'urgent' && { urgentReason: o.reason }),
            needsDelivery: !!o.delivery,
            ...(o.delivery && { deliveryDate: day(o.delivery) }),
            budget: o.budget,
            urgencyLevel: o.urgency,
            impact: o.impact,
            tags: o.tags,
            needs: o.needs,
            items,
            grandTotal: round2(items.reduce((a, i) => a + i.lineTotal, 0)),
            attachments,
            agree: true
        });
    };
    await equipment('priya', {
        status: 'submitted',
        phone: '23-456781',
        date: -1,
        manager: maria,
        approvers: [maria, david],
        priority: 'urgent',
        reason: 'Onboarding two new hires on Monday',
        delivery: 4,
        budget: 5000,
        urgency: 4,
        impact: 4,
        tags: ['onboarding', 'hardware'],
        needs: ['installation', 'training'],
        quote: ['quote-laptops.txt', 'Quote #1234\nLaptop 14" x2 @ 1200\nUSB-C dock x3 @ 150\n'],
        items: [
            item('Laptop 14"', 'laptop', 2, 1200, 'Replaces two failing devices'),
            item('USB-C dock', 'peripheral', 3, 150)
        ]
    });
    await equipment('tom', {
        status: 'processing',
        phone: '23-555010',
        date: -3,
        manager: david,
        approvers: [david],
        priority: 'normal',
        delivery: 9,
        budget: 1500,
        urgency: 2,
        impact: 3,
        tags: ['office'],
        needs: ['installation'],
        items: [
            item('Monitor 27"', 'monitor', 4, 280, 'Dual-screen setup for the support team'),
            item('Keyboard', 'peripheral', 4, 45)
        ]
    });
    await equipment('priya', {
        status: 'completed',
        phone: '23-456781',
        date: -12,
        manager: maria,
        approvers: [maria],
        priority: 'low',
        budget: 450,
        urgency: 1,
        impact: 2,
        tags: ['ergonomics'],
        needs: [],
        items: [item('Ergonomic chair', 'furniture', 1, 420)]
    });
    await equipment('maria', {
        status: 'completed',
        phone: '23-777002',
        date: -20,
        manager: david,
        approvers: [david],
        priority: 'normal',
        budget: 1500,
        urgency: 3,
        impact: 5,
        tags: ['finance', 'hardware'],
        needs: ['warranty'],
        quote: ['quote-laptop.txt', 'Quote #1188\nLaptop 16" x1 @ 1450\n'],
        items: [item('Laptop 16"', 'laptop', 1, 1450, 'Finance modelling needs more memory')]
    });
    await equipment('tom', {
        status: 'submitted',
        phone: '23-555010',
        date: 0,
        manager: maria,
        approvers: [maria, david],
        priority: 'urgent',
        reason: 'Support line opens next week',
        delivery: 3,
        budget: 600,
        urgency: 5,
        impact: 4,
        tags: ['support'],
        needs: ['installation', 'training'],
        items: [item('Headset', 'peripheral', 6, 85, 'One per agent on the new support line')]
    });
    await equipment('priya', {
        status: 'submitted',
        phone: '23-456781',
        date: -2,
        manager: david,
        approvers: [david],
        priority: 'normal',
        budget: 800,
        urgency: 2,
        impact: 3,
        tags: ['hardware'],
        needs: ['warranty'],
        items: [
            item('Monitor 24"', 'monitor', 2, 310, 'Replaces cracked screens'),
            item('HDMI cable', 'peripheral', 4, 12)
        ]
    });

    // Expense Report: repeatable expense lines with tax, computed totals
    const line = (date, category, description, amount, taxRate, receiptNo) => ({
        date: day(date),
        category,
        description,
        amount,
        taxRate,
        lineTotal: round2(amount * (1 + taxRate / 100)),
        receiptNo
    });
    const expense = (who, status, title, approver, lines, notes) =>
        submit(who, 'expense-report', status, {
            title,
            employee: who === 'tom' ? 'Tom Becker' : who === 'maria' ? 'Maria Santos' : 'Priya Nair',
            approver: approver.id,
            lines,
            total: round2(lines.reduce((a, l) => a + l.lineTotal, 0)),
            notes
        });
    await expense(
        'priya',
        'submitted',
        'Client visit, Berlin',
        maria,
        [
            line(-8, 'travel', 'Train Hamburg - Berlin', 89, 7, 'DB-88213'),
            line(-8, 'meals', 'Lunch with the client', 64.5, 19, 'R-1177'),
            line(-7, 'lodging', 'Hotel, 1 night', 142, 7, 'H-00391')
        ],
        'Client asked for a follow-up in November.'
    );
    await expense(
        'tom',
        'processing',
        'Team offsite supplies',
        david,
        [
            line(-5, 'office_supplies', 'Flip charts and markers', 48.9, 19, 'S-2201'),
            line(-5, 'meals', 'Catering, 8 people', 212, 7, 'C-0907')
        ],
        ''
    );
    await expense(
        'maria',
        'completed',
        'Conference: FinOps Days',
        david,
        [
            line(-25, 'travel', 'Flights', 310, 0, 'F-5521'),
            line(-24, 'lodging', 'Hotel, 2 nights', 260, 7, 'H-88120'),
            line(-24, 'meals', 'Dinner', 58, 19, 'R-3301')
        ],
        'Receipts scanned and filed.'
    );
    await expense(
        'priya',
        'submitted',
        'Home-office keyboard',
        maria,
        [line(-1, 'office_supplies', 'Mechanical keyboard', 79, 19, 'A-7781')],
        ''
    );

    // Leave Request: a form with no table template of its own (its table is derived from the fields)
    const leave = (who, status, type, from, days, half, reason) =>
        submit(who, 'leave-request', status, {
            employee: who === 'tom' ? 'Tom Becker' : who === 'maria' ? 'Maria Santos' : 'Priya Nair',
            leaveType: type,
            firstDay: day(from),
            days,
            halfDay: half,
            reason
        });
    await leave('priya', 'submitted', 'annual_leave', 14, 5, false, 'Family trip');
    await leave('tom', 'completed', 'sick_leave', -6, 2, false, 'Flu, doctor note attached');
    await leave('maria', 'submitted', 'annual_leave', 30, 10, false, 'Summer holiday');
    await leave('priya', 'processing', 'sick_leave', 2, 1, true, 'Dentist appointment');
    await leave('tom', 'submitted', 'annual_leave', 21, 3, false, '');

    // ---- where to click
    console.log(`\nseeded ${n} requests`);
    console.log(
        'Open ' +
            WEB +
            ' and sign in (password ' +
            PW +
            '):  admin@acme-corp.org (builder + delete)  |  priya.nair@acme-corp.org (submitter)'
    );
    for (const [slug, label] of [
        ['equipment-request', 'Equipment Request (hand-built dynamic table)'],
        ['expense-report', 'Expense Report (derived table)'],
        ['leave-request', 'Leave Request (derived table)']
    ])
        console.log(`  ${label}: ${WEB}/submitted-forms/template/${forms[slug].id}`);
    console.log('  Builder: ' + WEB + '/dynamic-template/saved-templates');
})().catch((e) => {
    console.error('SEED FAIL:', e.message);
    process.exit(1);
});
