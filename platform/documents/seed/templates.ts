/**
 * The Phase 0 templates: application copy, receipt, driver-licence card, exam result sheet, and the vehicle registration certificate (the temporary libre, ADR-0050). Their layouts stand in until a
 * bureau's forms and permission to copy them are known (docs/demo-plan.md); every word is the template's own, in Amharic and
 * English. Nothing here names a real office: that comes from the unit's header.
 */
import type { DocumentTemplateVersion } from '../contracts';

export interface TemplateSeed {
    key: string;
    name: { am: string; en: string };
    version: DocumentTemplateVersion;
}

const t = (am: string, en: string) => ({ am, en });

const STYLE = `<style>
h1{font-size:15pt;margin:0}
h2{font-size:11pt;margin:0;font-weight:400}
.head{display:flex;align-items:center;gap:12px;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:14px}
.head img{height:48px}
.title{font-size:13pt;font-weight:700;text-align:center;margin:0 0 12px}
table{width:100%;border-collapse:collapse;margin:8px 0}
th,td{border:1px solid #888;padding:4px 6px;text-align:start;vertical-align:top}
th{font-weight:700}
.num{text-align:end;font-variant-numeric:tabular-nums}
.facts{display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;margin-bottom:10px}
.term{font-weight:700}
.foot{margin-top:18px;font-size:9pt}
.stamp{height:80px;margin-top:10px}
.demo{font-weight:700;border:1px solid #111;padding:2px 6px;display:inline-block}
.qr-link{display:block;width:max-content}
.qr{width:26mm;height:26mm;display:block;margin-top:8mm}
</style>`;

/**
 * Scanned online it reports the document's status; offline, the verifier checks its signature. It links the same address, so a PDF
 * opened on a phone is checked with a tap.
 */
const QR = `{% if verification %}<a class="qr-link" href="{{ verification.url }}"><img class="qr" data-qr="{{ verification.url }}" src="{{ verification.qr }}" alt=""></a>{% endif %}`;

const HEAD = `<div class="head">{% if header.logo %}<img src="{{ header.logo }}" alt="">{% endif %}<div><h1>{{ header.title | text }}</h1>{% if header.subtitle %}<h2>{{ header.subtitle | text }}</h2>{% endif %}</div></div>`;

export const TEMPLATE_SEEDS: readonly TemplateSeed[] = [
    {
        key: 'receipt',
        name: t('ደረሰኝ', 'Receipt'),
        version: {
            paper: 'A5',
            dataSchema: 'receipt.v1',
            strings: {
                title: t('የገንዘብ መቀበያ ደረሰኝ', 'Payment receipt'),
                number: t('የደረሰኝ ቁጥር', 'Receipt number'),
                issuedOn: t('ቀን', 'Date'),
                case: t('ጉዳይ', 'Case'),
                service: t('አገልግሎት', 'Service'),
                receivedFrom: t('የተቀበለው ከ', 'Received from'),
                method: t('አከፋፈል', 'Method'),
                cash: t('ጥሬ ገንዘብ', 'Cash'),
                bank_slip: t('የባንክ ማስያዣ', 'Bank deposit slip'),
                item: t('ዝርዝር', 'Item'),
                quantity: t('ብዛት', 'Quantity'),
                amount: t('መጠን (ብር)', 'Amount (Birr)'),
                total: t('ጠቅላላ', 'Total'),
                demo: t('የማሳያ ሰነድ፤ ዋጋ የለውም', 'Demo document: of no value')
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.number }}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.issuedOn }}:</span> {{ issuedOn | ethdate }}</div>
<div><span class="term">{{ t.case }}:</span> {{ caseNumber }}</div>
<div><span class="term">{{ t.service }}:</span> {{ serviceName | text }}</div>
<div><span class="term">{{ t.receivedFrom }}:</span> {{ receivedFrom }}</div>
<div><span class="term">{{ t.method }}:</span> {% if method == "cash" %}{{ t.cash }}{% else %}{{ t.bank_slip }}{% endif %}</div>
</div>
<table><thead><tr><th>{{ t.item }}</th><th>{{ t.quantity }}</th><th class="num">{{ t.amount }}</th></tr></thead><tbody>
{% for line in lines %}<tr><td>{{ line.label | text }}</td><td>{{ line.quantity }}</td><td class="num">{{ line.amountSantim | birr }}</td></tr>{% endfor %}
<tr><th colspan="2">{{ t.total }}</th><th class="num">{{ amountSantim | birr }}</th></tr>
</tbody></table>
{% if header.stamp %}<img class="stamp" src="{{ header.stamp }}" alt="">{% endif %}
{% if demo %}<p class="foot"><span class="demo">{{ t.demo }}</span></p>{% endif %}${QR}`
        }
    },
    {
        key: 'application-copy',
        name: t('የማመልከቻ ቅጂ', 'Application copy'),
        version: {
            paper: 'A4',
            dataSchema: 'application-copy.v1',
            strings: {
                title: t('የማመልከቻ ቅጂ', 'Application copy'),
                case: t('ጉዳይ', 'Case'),
                service: t('አገልግሎት', 'Service'),
                filedOn: t('የቀረበበት ቀን', 'Filed on'),
                field: t('ጥያቄ', 'Question'),
                answer: t('መልስ', 'Answer'),
                signature: t('የአመልካች ፊርማ', "Applicant's signature")
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.case }}:</span> {{ caseNumber }}</div>
<div><span class="term">{{ t.filedOn }}:</span> {{ filedOn | ethdate }}</div>
<div><span class="term">{{ t.service }}:</span> {{ serviceName }}</div>
</div>
<table><thead><tr><th>{{ t.field }}</th><th>{{ t.answer }}</th></tr></thead><tbody>
{% for field in fields %}<tr><td>{{ field.label }}</td><td>{{ field.value }}</td></tr>{% endfor %}
</tbody></table>
<p class="foot">{{ t.signature }}: ______________________</p>${QR}`
        }
    },
    {
        key: 'licence-card',
        name: t('የመንጃ ፈቃድ ካርድ', 'Driver licence card'),
        version: {
            paper: 'card',
            dataSchema: 'licence-card.v1',
            strings: {
                title: t('የአሽከርካሪ ብቃት ማረጋገጫ ፈቃድ', 'Driver qualification licence'),
                number: t('ቁጥር', 'No.'),
                birth: t('የትውልድ ቀን', 'Born'),
                issued: t('የተሰጠበት', 'Issued'),
                valid: t('የሚያበቃበት', 'Valid until'),
                grades: t('ደረጃ', 'Grades')
            },
            body: `<style>
body{font-size:6.5pt;line-height:1.25}
.card{display:flex;gap:6px}
.card img{width:20mm;height:25mm;object-fit:cover}
.card .qr-link{margin-inline-start:auto}
.card img.qr{width:30mm;height:30mm}
.org{font-weight:700;font-size:7pt}
.ttl{font-weight:700;font-size:7.5pt;margin:1mm 0}
.term{font-weight:700}
</style>
<div class="org">{{ header.title | text }}</div><div class="ttl">{{ t.title }}</div>
<div class="card">{% if photo %}<img src="{{ photo }}" alt="">{% endif %}<div>
<div class="term" data-holder>{{ holderName }}</div>
<div><span class="term">{{ t.number }}:</span> {{ number }}</div>
{% if birthDate %}<div><span class="term">{{ t.birth }}:</span> {{ birthDate | ethdate }}</div>{% endif %}
<div><span class="term">{{ t.issued }}:</span> {{ issuedOn | ethdate }}</div>
<div><span class="term">{{ t.valid }}:</span> {{ validUntil | ethdate }}</div>
<div><span class="term">{{ t.grades }}:</span> {% for g in grades %}{{ g.grade }} ({{ g.name | text }}){% unless forloop.last %}, {% endunless %}{% endfor %}</div>
</div>${QR}</div>`
        }
    },
    {
        key: 'vehicle-registration-certificate',
        name: t('ጊዜያዊ የባለቤትነት ሊብሬ', 'Temporary ownership libre'),
        version: {
            paper: 'A4',
            dataSchema: 'vehicle-registration-certificate.v1',
            strings: {
                title: t('ጊዜያዊ የባለቤትነት ሊብሬ', 'Temporary ownership libre'),
                titleIssued: t('የተሽከርካሪ ምዝገባ ማረጋገጫ', 'Vehicle registration certificate'),
                notBooklet: t(
                    'ይህ የሊብሬ ደብተር አይደለም፤ ደብተሩ እስኪሰጥ ድረስ የሚያገለግል ነው።',
                    'This is not the libre booklet: it stands until the booklet is issued.'
                ),
                inBooklet: t('ተሽከርካሪው የተመዘገበበት የሊብሬ ደብተር ቁጥር', 'The libre booklet the vehicle is registered in'),
                number: t('ቁጥር', 'No.'),
                issuedOn: t('የተሰጠበት ቀን', 'Issued on'),
                plate: t('የሰሌዳ ቁጥር', 'Plate'),
                owner: t('የባለንብረቱ ስም', 'Owner'),
                address: t('አድራሻ', 'Address'),
                category: t('የተሽከርካሪው ዓይነት', 'Vehicle type'),
                makeModel: t('ሰሪና ሞዴል', 'Make and model'),
                year: t('የተሠራበት ዓመት', 'Year made'),
                madeIn: t('የተሠራበት አገር', 'Made in'),
                engine: t('የሞተር ቁጥር', 'Engine number'),
                chassis: t('የሻሲ ቁጥር', 'Chassis number'),
                cc: t('የሞተር መጠን (ሲሲ)', 'Engine size (cc)'),
                hp: t('የሞተር ኃይል (HP)', 'Engine power (HP)'),
                cylinders: t('ሲሊንደር', 'Cylinders'),
                fuel: t('የነዳጅ ዓይነት', 'Fuel'),
                colour: t('ቀለም', 'Colour'),
                size: t('ርዝመት × ስፋት × ቁመት (ሚ.ሜ)', 'Length × width × height (mm)'),
                tyres: t('የጎማ መጠንና ብዛት', 'Tyre size and count'),
                gross: t('ጠቅላላ ክብደት (ኪ.ግ)', 'Gross weight (kg)'),
                net: t('የተጣራ ክብደት (ኪ.ግ)', 'Net weight (kg)'),
                capacity: t('የመጫን አቅም', 'Capacity'),
                persons: t('ሰው', 'persons'),
                kg: t('ኪ.ግ', 'kg'),
                use: t('አገልግሎት', 'Service'),
                bolo: t('የቦሎ ቁጥር', 'Bolo number'),
                federalVehicleId: t('የፌዴራል ተሽከርካሪ መለያ', 'Federal vehicle id'),
                firstRegisteredOn: t('የመጀመሪያ ምዝገባ', 'First registered'),
                nationalReference: t('ብሔራዊ መለያ', 'National reference')
            },
            body: `${STYLE}${HEAD}<p class="title">{% if bookletSerial %}{{ t.titleIssued }}{% else %}{{ t.title }}{% endif %}</p>
<div class="facts">
<div><span class="term">{{ t.number }}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.issuedOn }}:</span> {{ issuedOn | ethdate }}</div>
<div><span class="term">{{ t.plate }}:</span> {{ plate }}</div>
<div><span class="term">{{ t.firstRegisteredOn }}:</span> {{ firstRegisteredOn | ethdate }}</div>
</div>
<table><thead><tr><th>{{ t.owner }}</th><th>{{ t.address }}</th></tr></thead><tbody>
{% for o in owners %}<tr><td data-holder>{{ o.name }}</td><td>{{ o.address }}</td></tr>{% endfor %}
</tbody></table>
<div class="facts">
<div><span class="term">{{ t.category }}:</span> {{ category | text }}</div>
<div><span class="term">{{ t.makeModel }}:</span> {{ make }} {{ model }}</div>
<div><span class="term">{{ t.year }}:</span> {{ modelYear }}</div>
{% if madeIn %}<div><span class="term">{{ t.madeIn }}:</span> {{ madeIn }}</div>{% endif %}
<div><span class="term">{{ t.chassis }}:</span> {{ chassisNumber }}</div>
{% if engineNumber %}<div><span class="term">{{ t.engine }}:</span> {{ engineNumber }}</div>{% endif %}
{% if engineCc %}<div><span class="term">{{ t.cc }}:</span> {{ engineCc }}</div>{% endif %}
{% if engineHp %}<div><span class="term">{{ t.hp }}:</span> {{ engineHp }}</div>{% endif %}
{% if cylinders %}<div><span class="term">{{ t.cylinders }}:</span> {{ cylinders }}</div>{% endif %}
{% if fuel %}<div><span class="term">{{ t.fuel }}:</span> {{ fuel | text }}</div>{% endif %}
{% if colour %}<div><span class="term">{{ t.colour }}:</span> {{ colour }}</div>{% endif %}
{% if lengthMm %}<div><span class="term">{{ t.size }}:</span> {{ lengthMm }} × {{ widthMm }} × {{ heightMm }}</div>{% endif %}
{% if tyres or tyreSize %}<div><span class="term">{{ t.tyres }}:</span> {{ tyreSize }}{% if tyres %} × {{ tyres }}{% endif %}</div>{% endif %}
{% if grossWeightKg %}<div><span class="term">{{ t.gross }}:</span> {{ grossWeightKg }}</div>{% endif %}
{% if netWeightKg %}<div><span class="term">{{ t.net }}:</span> {{ netWeightKg }}</div>{% endif %}
{% if seats %}<div><span class="term">{{ t.capacity }}:</span> {{ seats }} {{ t.persons }}</div>{% elsif loadCapacityKg %}<div><span class="term">{{ t.capacity }}:</span> {{ loadCapacityKg }} {{ t.kg }}</div>{% endif %}
<div><span class="term">{{ t.use }}:</span> {{ use | text }}</div>
{% if boloNumber %}<div><span class="term">{{ t.bolo }}:</span> {{ boloNumber }}</div>{% endif %}
{% if federalVehicleId %}<div><span class="term">{{ t.federalVehicleId }}:</span> {{ federalVehicleId }}</div>{% endif %}
</div>
{% if bookletSerial %}<p><span class="term">{{ t.inBooklet }}:</span> <span data-booklet>{{ bookletSerial }}</span>{% if nationalReference %} · {{ t.nationalReference }}: {{ nationalReference }}{% endif %}</p>{% else %}<p class="demo" data-not-booklet>{{ t.notBooklet }}</p>{% endif %}
{% if header.stamp %}<img class="stamp" src="{{ header.stamp }}" alt="">{% endif %}${QR}`
        }
    },
    {
        key: 'exam-result',
        name: t('የፈተና ውጤት ማሳወቂያ', 'Exam result sheet'),
        version: {
            paper: 'A4',
            dataSchema: 'exam-result.v1',
            strings: {
                title: t('የፈተና ውጤት ማሳወቂያ', 'Exam result sheet'),
                service: t('አገልግሎት', 'Service'),
                sessionOn: t('የፈተና ቀን', 'Exam date'),
                name: t('ስም', 'Name'),
                grade: t('ደረጃ', 'Grade'),
                theory: t('ንድፈ ሐሳብ', 'Theory'),
                practical: t('ተግባር', 'Practical'),
                result: t('ውጤት', 'Result'),
                passed: t('አልፏል', 'Passed'),
                failed: t('አላለፈም', 'Failed'),
                examiner: t('የፈታኝ ፊርማ', "Examiner's signature")
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.service }}:</span> {{ serviceName | text }}</div>
<div><span class="term">{{ t.sessionOn }}:</span> {{ sessionOn | ethdate }}</div>
</div>
<table><thead><tr><th>{{ t.name }}</th><th>{{ t.grade }}</th><th class="num">{{ t.theory }}</th><th class="num">{{ t.practical }}</th><th>{{ t.result }}</th></tr></thead><tbody>
{% for c in candidates %}<tr><td>{{ c.name }}</td><td>{{ c.grade }}</td><td class="num">{{ c.theory }}</td><td class="num">{{ c.practical }}</td><td>{% if c.passed %}{{ t.passed }}{% else %}{{ t.failed }}{% endif %}</td></tr>{% endfor %}
</tbody></table>
<p class="foot">{{ t.examiner }}: ______________________</p>${QR}`
        }
    }
];
