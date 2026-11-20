/**
 * The Phase 0 templates: application copy, receipt, driver-licence card, a renewal's medical referral letter (task 1.6a), exam result sheet, the vehicle registration certificate (the temporary libre, ADR-0050), the three letters of an ownership transfer (task 1.4b), and the vehicle data transfer document with its covering letter (task 1.4c2), and the office's remittance (task 1.12d). Their layouts stand in until a
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

/** What a template prints for a value the document has none of. */
const DASH = '—';

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
        key: 'licence-medical-referral',
        name: t('የህክምና ምርመራ ሪፈራል ደብዳቤ', 'Medical examination referral letter'),
        version: {
            paper: 'A4',
            dataSchema: 'licence-medical-referral.v1',
            strings: {
                title: t('የአሽከርካሪ የአካል ብቃት ምርመራ ሪፈራል', "Referral for a driver's physical examination"),
                to: t('ለ', 'To'),
                number: t('ቁጥር', 'No.'),
                issuedOn: t('ቀን', 'Date'),
                caseNumber: t('የጉዳይ ቁጥር', 'Case number'),
                subject: t('ጉዳዩ', 'Subject'),
                subjectText: t(
                    'የመንጃ ፈቃድ እድሳት የአካል ብቃት ምርመራ እንዲደረግ ስለመጠየቅ',
                    'Request for the physical examination of a driver licence renewal'
                ),
                holder: t('የፈቃዱ ባለቤት', 'Licence holder'),
                licenceNumber: t('የመንጃ ፈቃድ ቁጥር', 'Licence number'),
                cardSerial: t('የካርድ ሴሪ ቁጥር', 'Card serial'),
                grades: t('ደረጃ', 'Grades'),
                validUntil: t('ፈቃዱ የሚያበቃበት ቀን', 'Licence expiry'),
                ask: t(
                    'ከላይ የተጠቀሱት የመንጃ ፈቃድ ባለቤት የፈቃድ እድሳት ጊዜያቸው ስለደረሰ በጤና ቢሮው "የአሽከርካሪዎች የአካል ብቃት ምርመራ ሪፖርት" ቅጽ መሠረት (ዓይን፣ የመስማት ችሎታና ሌሎች) ተመርምረው ውጤቱን እንድትልኩልን እንጠይቃለን።',
                    'The licence holder above is due to renew their licence. We ask you to examine them on the health bureau’s "Drivers physical examination report" (eyes, hearing and the other items) and send us the report.'
                ),
                attempt: t('ሪፈራል', 'Referral'),
                attemptOf: t('ከ', 'of'),
                signature: t('የሰጪው ባለሥልጣን ፊርማ', "Issuing officer's signature")
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.number }}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.issuedOn }}:</span> {{ issuedOn | ethdate }}</div>
<div><span class="term">{{ t.caseNumber }}:</span> {{ caseNumber }}</div>
<div><span class="term">{{ t.attempt }}:</span> <span data-attempt>{{ attempt }}</span> {{ t.attemptOf }} {{ of }}</div>
</div>
<p><span class="term">{{ t.to }}:</span> <span data-institution>{{ institution }}</span></p>
<p><span class="term">{{ t.subject }}:</span> {{ t.subjectText }}</p>
<div class="facts">
<div><span class="term">{{ t.holder }}:</span> <span data-holder>{{ holderName }}</span></div>
<div><span class="term">{{ t.licenceNumber }}:</span> {{ licence.number }}</div>
<div><span class="term">{{ t.cardSerial }}:</span> {% if licence.cardSerial %}{{ licence.cardSerial }}{% else %}${DASH}{% endif %}</div>
<div><span class="term">{{ t.validUntil }}:</span> {% if licence.validUntil %}{{ licence.validUntil | ethdate }}{% else %}${DASH}{% endif %}</div>
<div><span class="term">{{ t.grades }}:</span> {% for g in licence.grades %}{{ g.name | text }}{% unless forloop.last %}, {% endunless %}{% endfor %}</div>
</div>
<p>{{ t.ask }}</p>
<p class="foot">{{ t.signature }}: ______________________</p>
{% if header.stamp %}<img class="stamp" src="{{ header.stamp }}" alt="">{% endif %}${QR}`
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
    ...(['vehicle-bolo', 'vehicle-temporary-bolo'] as const).map((key): TemplateSeed => ({
        key,
        name:
            key === 'vehicle-bolo'
                ? t('የተሽከርካሪ ዓመታዊ ምርመራ (ቦሎ)', 'Vehicle annual inspection (bolo)')
                : t('ጊዜያዊ ቦሎ', 'Temporary bolo'),
        version: {
            paper: 'A5',
            dataSchema: 'vehicle-bolo.v1',
            strings: {
                title: t('የተሽከርካሪ ዓመታዊ የቴክኒክ ምርመራ ማረጋገጫ (ቦሎ)', 'Vehicle annual technical inspection (bolo)'),
                titleTemporary: t('ጊዜያዊ ቦሎ', 'Temporary bolo'),
                temporaryNote: t(
                    'ይህ ጊዜያዊ ቦሎ ነው፤ የቦሎ ምልክቱ እስኪሰጥ ድረስ እስከ ተጠቀሰው ቀን ብቻ ያገለግላል።',
                    'This is a temporary bolo: it stands only to the day shown, until the bolo sticker is issued.'
                ),
                number: t('ቁጥር', 'No.'),
                sticker: t('የቦሎ ምልክት ቁጥር', 'Bolo sticker number'),
                plate: t('የሰሌዳ ቁጥር', 'Plate'),
                chassis: t('የሻሲ ቁጥር', 'Chassis number'),
                makeModel: t('ሰሪና ሞዴል', 'Make and model'),
                category: t('የተሽከርካሪው ዓይነት', 'Vehicle type'),
                use: t('አገልግሎት', 'Service'),
                checklist: t('የምርመራ ቅጽ ቁጥር', 'Inspection checklist number'),
                inspectedOn: t('የተመረመረበት ቀን', 'Inspected on'),
                fiscalYear: t('የበጀት ዓመት', 'Fiscal year'),
                validUntil: t('የሚያገለግለው እስከ', 'Valid until'),
                temporaryUntil: t('ጊዜያዊው የሚያገለግለው እስከ', 'Temporary bolo valid until'),
                insurance: t('የሦስተኛ ወገን መድን', 'Third-party insurance'),
                insurer: t('መድን ሰጪ', 'Insurer'),
                insuredUntil: t('ፖሊሲው የሚያበቃበት', 'Policy ends'),
                efy: t('ዓ.ም', 'E.C.')
            },
            body: `${STYLE}${HEAD}<p class="title">{% if temporaryUntil %}{{ t.titleTemporary }}{% else %}{{ t.title }}{% endif %}</p>
<div class="facts">
<div><span class="term">{% if temporaryUntil %}{{ t.number }}{% else %}{{ t.sticker }}{% endif %}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.plate }}:</span> {{ plate }}</div>
<div><span class="term">{{ t.chassis }}:</span> {{ chassisNumber }}</div>
<div><span class="term">{{ t.makeModel }}:</span> {{ make }} {{ model }}</div>
<div><span class="term">{{ t.category }}:</span> {{ category | text }}</div>
<div><span class="term">{{ t.use }}:</span> {{ use | text }}</div>
<div><span class="term">{{ t.checklist }}:</span> {{ checklistSerial }}</div>
<div><span class="term">{{ t.inspectedOn }}:</span> {{ inspectedOn | ethdate }}</div>
<div><span class="term">{{ t.fiscalYear }}:</span> {{ fiscalYear }} {{ t.efy }}</div>
<div><span class="term">{{ t.validUntil }}:</span> <span data-valid-until>{{ validUntil | ethdate }}</span></div>
{% if temporaryUntil %}<div><span class="term">{{ t.temporaryUntil }}:</span> <span data-temporary-until>{{ temporaryUntil | ethdate }}</span></div>{% endif %}
</div>
<p><span class="term">{{ t.insurance }}:</span> {{ insurance.certificate }} · {{ t.insurer }}: {{ insurance.insurer }} · {{ t.insuredUntil }}: {{ insurance.until | ethdate }}</p>
{% if temporaryUntil %}<p class="demo" data-temporary>{{ t.temporaryNote }}</p>{% endif %}
{% if header.stamp %}<img class="stamp" src="{{ header.stamp }}" alt="">{% endif %}${QR}`
        }
    })),
    {
        key: 'vehicle-transfer-justice-letter',
        name: t('ውል ለማረጋገጥ የሚጻፍ ደብዳቤ', 'Letter to authenticate the contract'),
        version: {
            paper: 'A4',
            dataSchema: 'vehicle-transfer-letter.v1',
            strings: {
                to: t('ለ', 'To'),
                number: t('ቁጥር', 'No.'),
                issuedOn: t('ቀን', 'Date'),
                caseNumber: t('የጉዳይ ቁጥር', 'Case number'),
                validUntil: t('ደብዳቤው የሚያገለግለው እስከ', 'This letter stands until'),
                subject: t('ጉዳዩ', 'Subject'),
                reason: t('የዝውውሩ ምክንያት', 'Reason for the transfer'),
                plate: t('የሰሌዳ ቁጥር', 'Plate'),
                chassis: t('የሻሲ ቁጥር', 'Chassis number'),
                engine: t('የሞተር ቁጥር', 'Engine number'),
                makeModel: t('ሰሪና ሞዴል', 'Make and model'),
                year: t('የተሠራበት ዓመት', 'Year made'),
                category: t('የተሽከርካሪው ዓይነት', 'Vehicle type'),
                use: t('አገልግሎት', 'Service'),
                sellers: t('የአሁኑ ባለቤት (ሰጪ)', 'Current owner (transferor)'),
                buyers: t('አዲሱ ባለቤት (ተቀባይ)', 'New owner (transferee)'),
                signature: t('የሰጪው ባለሥልጣን ፊርማ', "Issuing officer's signature"),
                title: t('የተሽከርካሪ ባለቤትነት ዝውውር ውል ማረጋገጫ ጥያቄ', 'Request to authenticate a vehicle transfer contract'),
                subjectText: t(
                    'የተሽከርካሪ ባለቤትነት (ስም) ዝውውር ውል እንዲረጋገጥ ስለመጠየቅ',
                    'Request to authenticate the contract of a vehicle ownership transfer'
                ),
                ask: t(
                    'ከላይ የተመለከተው ተሽከርካሪ የባለቤትነት ዝውውር እንዲፈጸም ጥያቄ ቀርቦልናል። ስለዚህ በአሁኑ ባለቤትና በአዲሱ ባለቤት መካከል የሚደረገውን የዝውውር ውል (ሰነድ) እንዲያረጋግጡልን እንጠይቃለን።',
                    'A request has been made to transfer the ownership of the vehicle above. We ask you to authenticate the contract (deed) of the transfer between the current owner and the new owner.'
                ),
                noEncumbrance: t(
                    'በመዝገባችን መሠረት ተሽከርካሪው ዕዳ ዕገዳ የለበትም፤ ይህ የተረጋገጠው እስከ',
                    'According to our register the vehicle has no debt or encumbrance as of'
                )
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.number }}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.issuedOn }}:</span> {{ issuedOn | ethdate }}</div>
<div><span class="term">{{ t.caseNumber }}:</span> {{ caseNumber }}</div>
<div><span class="term">{{ t.validUntil }}:</span> <span data-valid-until>{{ validUntil | ethdate }}</span></div>
</div>
<p><span class="term">{{ t.to }}:</span> {{ addressee }}</p>
<p><span class="term">{{ t.subject }}:</span> {{ t.subjectText }}</p>
<div class="facts">
<div><span class="term">{{ t.plate }}:</span> {{ vehicle.plate }}</div>
<div><span class="term">{{ t.chassis }}:</span> {{ vehicle.chassisNumber }}</div>
{% if vehicle.engineNumber %}<div><span class="term">{{ t.engine }}:</span> {{ vehicle.engineNumber }}</div>{% endif %}
<div><span class="term">{{ t.makeModel }}:</span> {{ vehicle.make }} {{ vehicle.model }}</div>
<div><span class="term">{{ t.year }}:</span> {{ vehicle.modelYear }}</div>
<div><span class="term">{{ t.category }}:</span> {{ vehicle.category | text }}</div>
<div><span class="term">{{ t.use }}:</span> {{ vehicle.use | text }}</div>
<div><span class="term">{{ t.reason }}:</span> {{ acquiredBy | text }}</div>
</div>
<table><thead><tr><th>{{ t.sellers }}</th><th>{{ t.buyers }}</th></tr></thead><tbody>
<tr><td>{% for s in sellers %}<div data-seller>{{ s.name }}</div>{% endfor %}</td><td>{% for b in buyers %}<div data-buyer>{{ b.name }}</div>{% endfor %}</td></tr>
</tbody></table>
<p>{{ t.ask }}</p>
<p data-no-encumbrance>{{ t.noEncumbrance }} {{ issuedOn | ethdate }}.</p>
<p class="foot">{{ t.signature }}: ______________________</p>
{% if header.stamp %}<img class="stamp" src="{{ header.stamp }}" alt="">{% endif %}${QR}`
        }
    },
    {
        key: 'vehicle-transfer-revenue-letter',
        name: t('የተሽከርካሪ ዋጋ የሚገለጽበት ደብዳቤ', 'Letter giving the vehicle value'),
        version: {
            paper: 'A4',
            dataSchema: 'vehicle-transfer-letter.v1',
            strings: {
                to: t('ለ', 'To'),
                number: t('ቁጥር', 'No.'),
                issuedOn: t('ቀን', 'Date'),
                caseNumber: t('የጉዳይ ቁጥር', 'Case number'),
                validUntil: t('ደብዳቤው የሚያገለግለው እስከ', 'This letter stands until'),
                subject: t('ጉዳዩ', 'Subject'),
                reason: t('የዝውውሩ ምክንያት', 'Reason for the transfer'),
                plate: t('የሰሌዳ ቁጥር', 'Plate'),
                chassis: t('የሻሲ ቁጥር', 'Chassis number'),
                engine: t('የሞተር ቁጥር', 'Engine number'),
                makeModel: t('ሰሪና ሞዴል', 'Make and model'),
                year: t('የተሠራበት ዓመት', 'Year made'),
                category: t('የተሽከርካሪው ዓይነት', 'Vehicle type'),
                use: t('አገልግሎት', 'Service'),
                sellers: t('የአሁኑ ባለቤት (ሰጪ)', 'Current owner (transferor)'),
                buyers: t('አዲሱ ባለቤት (ተቀባይ)', 'New owner (transferee)'),
                signature: t('የሰጪው ባለሥልጣን ፊርማ', "Issuing officer's signature"),
                title: t('የተሽከርካሪ ባለቤትነት ዝውውር ዋጋ ማሳወቂያ', 'Notice of the value set for a vehicle ownership transfer'),
                subjectText: t(
                    'በተሽከርካሪ ባለቤትነት (ስም) ዝውውር ላይ የሚከፈለው የቴምብር ቀረጥ እንዲወሰን ስለመጠየቅ',
                    'Request to determine the stamp duty on a vehicle ownership transfer'
                ),
                ask: t(
                    'ከላይ የተመለከተው ተሽከርካሪ የባለቤትነት ዝውውር እንዲፈጸም ጥያቄ ቀርቦልናል። ተሽከርካሪው ተመርምሮ የዋጋ ግምት ኮሚቴ የወሰነውን ዋጋ ከታች እንልካለን።',
                    'A request has been made to transfer the ownership of the vehicle above. The vehicle was inspected, and we send below the value the valuation committee set.'
                ),
                valuation: t('የዋጋ ግምት', 'Valuation'),
                valuedOn: t('የተገመተበት ቀን', 'Valued on'),
                purchasePrice: t('የግዢ ዋጋ (ብር)', 'Purchase price (Birr)'),
                marketValue: t('የገበያ ዋጋ (ብር)', 'Market value (Birr)'),
                contractValue: t('በውሉ የተጠቀሰ ዋጋ (ብር)', 'Value stated in the contract (Birr)'),
                committeeValue: t('ኮሚቴው የወሰነው ዋጋ (ብር)', 'Value set by the committee (Birr)'),
                valuers: t('የገማቾች ስም', 'Valuers'),
                inspectionNote: t('የምርመራ ማስታወሻ', 'Inspection note'),
                dutyNote: t(
                    'በተወሰነው ዋጋ ላይ የቴምብር ቀረጥ ይከፈላል፤ የቀረጡን መጠን የሚወስነው የገቢዎች ጽ/ቤት ነው።',
                    "Stamp duty is to be paid on the value set: the duty is the revenue office's to determine."
                )
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.number }}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.issuedOn }}:</span> {{ issuedOn | ethdate }}</div>
<div><span class="term">{{ t.caseNumber }}:</span> {{ caseNumber }}</div>
<div><span class="term">{{ t.validUntil }}:</span> <span data-valid-until>{{ validUntil | ethdate }}</span></div>
</div>
<p><span class="term">{{ t.to }}:</span> {{ addressee }}</p>
<p><span class="term">{{ t.subject }}:</span> {{ t.subjectText }}</p>
<div class="facts">
<div><span class="term">{{ t.plate }}:</span> {{ vehicle.plate }}</div>
<div><span class="term">{{ t.chassis }}:</span> {{ vehicle.chassisNumber }}</div>
{% if vehicle.engineNumber %}<div><span class="term">{{ t.engine }}:</span> {{ vehicle.engineNumber }}</div>{% endif %}
<div><span class="term">{{ t.makeModel }}:</span> {{ vehicle.make }} {{ vehicle.model }}</div>
<div><span class="term">{{ t.year }}:</span> {{ vehicle.modelYear }}</div>
<div><span class="term">{{ t.category }}:</span> {{ vehicle.category | text }}</div>
<div><span class="term">{{ t.use }}:</span> {{ vehicle.use | text }}</div>
<div><span class="term">{{ t.reason }}:</span> {{ acquiredBy | text }}</div>
</div>
<table><thead><tr><th>{{ t.sellers }}</th><th>{{ t.buyers }}</th></tr></thead><tbody>
<tr><td>{% for s in sellers %}<div data-seller>{{ s.name }}</div>{% endfor %}</td><td>{% for b in buyers %}<div data-buyer>{{ b.name }}</div>{% endfor %}</td></tr>
</tbody></table>
<p>{{ t.ask }}</p>
{% if valuation %}<table><thead><tr><th colspan="2">{{ t.valuation }}</th></tr></thead><tbody>
<tr><td>{{ t.valuedOn }}</td><td>{{ valuation.valuedOn | ethdate }}</td></tr>
{% if valuation.purchasePriceSantim %}<tr><td>{{ t.purchasePrice }}</td><td class="num">{{ valuation.purchasePriceSantim | birr }}</td></tr>{% endif %}
{% if valuation.marketValueSantim %}<tr><td>{{ t.marketValue }}</td><td class="num">{{ valuation.marketValueSantim | birr }}</td></tr>{% endif %}
{% if valuation.contractValueSantim %}<tr><td>{{ t.contractValue }}</td><td class="num">{{ valuation.contractValueSantim | birr }}</td></tr>{% endif %}
<tr><th>{{ t.committeeValue }}</th><th class="num" data-value>{{ valuation.committeeValueSantim | birr }}</th></tr>
{% if valuation.valuers %}<tr><td>{{ t.valuers }}</td><td>{{ valuation.valuers }}</td></tr>{% endif %}
{% if valuation.inspectionNote %}<tr><td>{{ t.inspectionNote }}</td><td>{{ valuation.inspectionNote }}</td></tr>{% endif %}
</tbody></table>{% endif %}
<p data-duty-note>{{ t.dutyNote }}</p>
<p class="foot">{{ t.signature }}: ______________________</p>
{% if header.stamp %}<img class="stamp" src="{{ header.stamp }}" alt="">{% endif %}${QR}`
        }
    },
    {
        key: 'vehicle-transfer-tax-letter',
        name: t('የንግድ ግብር ከፋይ ለማስመዝገብ የሚጻፍ ደብዳቤ', 'Letter to register business taxpayers'),
        version: {
            paper: 'A4',
            dataSchema: 'vehicle-transfer-letter.v1',
            strings: {
                to: t('ለ', 'To'),
                number: t('ቁጥር', 'No.'),
                issuedOn: t('ቀን', 'Date'),
                caseNumber: t('የጉዳይ ቁጥር', 'Case number'),
                validUntil: t('ደብዳቤው የሚያገለግለው እስከ', 'This letter stands until'),
                subject: t('ጉዳዩ', 'Subject'),
                reason: t('የዝውውሩ ምክንያት', 'Reason for the transfer'),
                plate: t('የሰሌዳ ቁጥር', 'Plate'),
                chassis: t('የሻሲ ቁጥር', 'Chassis number'),
                engine: t('የሞተር ቁጥር', 'Engine number'),
                makeModel: t('ሰሪና ሞዴል', 'Make and model'),
                year: t('የተሠራበት ዓመት', 'Year made'),
                category: t('የተሽከርካሪው ዓይነት', 'Vehicle type'),
                use: t('አገልግሎት', 'Service'),
                sellers: t('የአሁኑ ባለቤት (ሰጪ)', 'Current owner (transferor)'),
                buyers: t('አዲሱ ባለቤት (ተቀባይ)', 'New owner (transferee)'),
                signature: t('የሰጪው ባለሥልጣን ፊርማ', "Issuing officer's signature"),
                title: t('የንግድ ግብር ከፋይ ምዝገባ ጥያቄ', 'Request to register business taxpayers'),
                subjectText: t(
                    'የተሽከርካሪው አዲስ ባለቤቶች በንግድ ግብር ከፋይነት እንዲመዘገቡ ስለመጠየቅ',
                    'Request to register the vehicle’s new owners as business taxpayers'
                ),
                ask: t(
                    'ከላይ የተመለከተው ተሽከርካሪ ለንግድ አገልግሎት የሚውል (ኮድ 3) ነው። የባለቤትነት ዝውውር እንዲፈጸም ጥያቄ ቀርቦልናል፤ ስለዚህ አዲሶቹ ባለቤቶች በንግድ ግብር ከፋይነት እንዲመዘገቡ እንጠይቃለን።',
                    'The vehicle above is in commercial service (code 3). A request has been made to transfer its ownership, so we ask you to register the new owners as business taxpayers.'
                )
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.number }}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.issuedOn }}:</span> {{ issuedOn | ethdate }}</div>
<div><span class="term">{{ t.caseNumber }}:</span> {{ caseNumber }}</div>
<div><span class="term">{{ t.validUntil }}:</span> <span data-valid-until>{{ validUntil | ethdate }}</span></div>
</div>
<p><span class="term">{{ t.to }}:</span> {{ addressee }}</p>
<p><span class="term">{{ t.subject }}:</span> {{ t.subjectText }}</p>
<div class="facts">
<div><span class="term">{{ t.plate }}:</span> {{ vehicle.plate }}</div>
<div><span class="term">{{ t.chassis }}:</span> {{ vehicle.chassisNumber }}</div>
{% if vehicle.engineNumber %}<div><span class="term">{{ t.engine }}:</span> {{ vehicle.engineNumber }}</div>{% endif %}
<div><span class="term">{{ t.makeModel }}:</span> {{ vehicle.make }} {{ vehicle.model }}</div>
<div><span class="term">{{ t.year }}:</span> {{ vehicle.modelYear }}</div>
<div><span class="term">{{ t.category }}:</span> {{ vehicle.category | text }}</div>
<div><span class="term">{{ t.use }}:</span> {{ vehicle.use | text }}</div>
<div><span class="term">{{ t.reason }}:</span> {{ acquiredBy | text }}</div>
</div>
<table><thead><tr><th>{{ t.sellers }}</th><th>{{ t.buyers }}</th></tr></thead><tbody>
<tr><td>{% for s in sellers %}<div data-seller>{{ s.name }}</div>{% endfor %}</td><td>{% for b in buyers %}<div data-buyer>{{ b.name }}</div>{% endfor %}</td></tr>
</tbody></table>
<p data-business-taxpayer>{{ t.ask }}</p>
<p class="foot">{{ t.signature }}: ______________________</p>
{% if header.stamp %}<img class="stamp" src="{{ header.stamp }}" alt="">{% endif %}${QR}`
        }
    },
    {
        key: 'vehicle-transfer-document',
        name: t('የተሽከርካሪ መረጃ ማስተላለፊያ ሰነድ', 'Vehicle data transfer document'),
        version: {
            paper: 'A4',
            dataSchema: 'vehicle-transfer-document.v1',
            strings: {
                title: t('የተሽከርካሪ መረጃ ማስተላለፊያ ሰነድ', 'Vehicle data transfer document'),
                number: t('ቁጥር', 'No.'),
                issuedOn: t('ቀን', 'Date'),
                caseNumber: t('የጉዳይ ቁጥር', 'Case number'),
                validUntil: t('ሰነዱ የሚያገለግለው እስከ', 'This document stands until'),
                destination: t('የሚዛወርበት መሥሪያ ቤት', 'Going to'),
                region: t('ክልል', 'Region'),
                owners: t('የተሽከርካሪው ባለቤት', 'Owner of the vehicle'),
                address: t('አድራሻ', 'Address'),
                plate: t('የሰሌዳ ቁጥር', 'Plate'),
                chassis: t('የሻሲ ቁጥር', 'Chassis number'),
                engine: t('የሞተር ቁጥር', 'Engine number'),
                makeModel: t('ሰሪና ሞዴል', 'Make and model'),
                year: t('የተሠራበት ዓመት', 'Year made'),
                category: t('የተሽከርካሪው ዓይነት', 'Vehicle type'),
                use: t('አገልግሎት', 'Service'),
                plates: t('ተሽከርካሪው የያዛቸው ሰሌዳዎች', 'Plates the vehicle has carried'),
                since: t('ከ', 'From'),
                until: t('እስከ', 'Until'),
                place: t('ሰሌዳው የተሰጠበት ቦታ', 'Where the plate was issued'),
                efy: t('ዓ.ም', 'E.C.'),
                customs: t('የጉምሩክ ማሳወቂያ ቁጥር', 'Customs declaration number'),
                taxReceipt: t('የግብር ደረሰኝ ቁጥር', 'Tax receipt number'),
                purchaseValue: t('የግዢ ዋጋ (ብር)', 'Purchase value (Birr)'),
                excise: t('የተከፈለ ኤክሳይስ ታክስ (ብር)', 'Excise tax paid (Birr)'),
                bolo: t('ቦሎ', 'Bolo'),
                boloSerial: t('የተለጣፊ ቁጥር', 'Sticker serial'),
                boloUntil: t('የሚያገለግለው እስከ', 'Stands until'),
                boloTemporary: t('ጊዜያዊ ቦሎ', 'Temporary bolo'),
                holds: t('ዕዳና ዕገዳዎች', 'Debts and holds'),
                holdKind: t('ዓይነት', 'Kind'),
                holdHolder: t('ባለመብቱ', 'Holder'),
                holdReference: t('የደብዳቤ ቁጥር', 'Letter reference'),
                holdDate: t('የደብዳቤ ቀን', 'Letter date'),
                holdAmount: t('መጠን (ብር)', 'Amount (Birr)'),
                none: t('የለም', 'none'),
                remarks: t('ማስታወሻ', 'Remarks'),
                preparedBy: t('ያዘጋጀው', 'Prepared by'),
                approvedBy: t('ያጸደቀው', 'Approved by'),
                ruleErasure: t(
                    'በሰነዱ ላይ ማንኛውም ስርዝ ድርዝ ወይም ማጥፊያ ዋጋ የለውም።',
                    'Any erasure or overwriting on this document makes it void.'
                ),
                ruleValid: t('ይህ ሰነድ እስከ', 'This document is valid until'),
                ruleValidEnd: t('ድረስ ብቻ ያገለግላል።', 'only.'),
                ruleVoid: t(
                    'በተጠቀሰው ጊዜ ውስጥ አገልግሎቱ ካልተሰጠ ሰነዱ ዋጋ አልባ ይሆናል።',
                    'If the service is not given within that time, the document is void.'
                )
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.number }}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.issuedOn }}:</span> {{ issuedOn | ethdate }}</div>
<div><span class="term">{{ t.caseNumber }}:</span> {{ caseNumber }}</div>
<div><span class="term">{{ t.validUntil }}:</span> <span data-valid-until>{{ validUntil | ethdate }}</span></div>
<div><span class="term">{{ t.destination }}:</span> <span data-destination>{{ destination.name }}</span></div>
<div><span class="term">{{ t.region }}:</span> {{ destination.region | default: "${DASH}" }}</div>
</div>
<table><thead><tr><th>{{ t.owners }}</th><th>{{ t.address }}</th></tr></thead><tbody>
{% for o in owners %}<tr><td data-owner>{{ o.name }}</td><td>{{ o.address | default: "${DASH}" }}</td></tr>{% endfor %}
</tbody></table>
<div class="facts">
<div><span class="term">{{ t.plate }}:</span> {{ vehicle.plate }}</div>
<div><span class="term">{{ t.chassis }}:</span> {{ vehicle.chassisNumber }}</div>
<div><span class="term">{{ t.engine }}:</span> {{ vehicle.engineNumber | default: "${DASH}" }}</div>
<div><span class="term">{{ t.makeModel }}:</span> {{ vehicle.make }} {{ vehicle.model }}</div>
<div><span class="term">{{ t.year }}:</span> {{ vehicle.modelYear | default: "${DASH}" }}</div>
<div><span class="term">{{ t.category }}:</span> {{ vehicle.category | text }}</div>
<div><span class="term">{{ t.use }}:</span> {{ vehicle.use | text }}</div>
</div>
<table><thead><tr><th>{{ t.plates }}</th><th>{{ t.since }}</th><th>{{ t.until }}</th><th>{{ t.place }}</th></tr></thead><tbody>
{% for p in plates %}<tr><td data-plate>{{ p.plate }}</td><td>{% if p.since %}{{ p.since | ethdate }}{% elsif p.year %}{{ p.year }} {{ t.efy }}{% else %}${DASH}{% endif %}</td><td>{% if p.until %}{{ p.until | ethdate }}{% else %}${DASH}{% endif %}</td><td>{{ p.place | default: "${DASH}" }}</td></tr>{% endfor %}
</tbody></table>
<div class="facts">
<div><span class="term">{{ t.customs }}:</span> {{ customsDeclarationNumber | default: "${DASH}" }}</div>
<div><span class="term">{{ t.taxReceipt }}:</span> {{ taxReceiptNumber | default: "${DASH}" }}</div>
<div><span class="term">{{ t.purchaseValue }}:</span> {% if purchaseValueSantim %}{{ purchaseValueSantim | birr }}{% else %}${DASH}{% endif %}</div>
<div><span class="term">{{ t.excise }}:</span> {% if excisePaidSantim %}{{ excisePaidSantim | birr }}{% else %}${DASH}{% endif %}</div>
</div>
<p><span class="term">{{ t.bolo }}:</span> {% if bolo %}{{ t.boloSerial }}: {{ bolo.serial | default: "${DASH}" }} · {{ t.boloUntil }}: {{ bolo.validUntil | ethdate }}{% if bolo.temporary %} ({{ t.boloTemporary }}){% endif %}{% else %}${DASH}{% endif %}</p>
<table><thead><tr><th colspan="5">{{ t.holds }}</th></tr></thead><tbody>
{% if holds.size == 0 %}<tr><td colspan="5"><span data-holds-none>{{ t.none }}</span></td></tr>{% else %}<tr><th>{{ t.holdKind }}</th><th>{{ t.holdHolder }}</th><th>{{ t.holdReference }}</th><th>{{ t.holdDate }}</th><th class="num">{{ t.holdAmount }}</th></tr>
{% for h in holds %}<tr data-hold><td>{{ h.kind | text }}</td><td>{{ h.holder }}</td><td>{{ h.letterReference }}</td><td>{{ h.letterDate | ethdate }}</td><td class="num">{% if h.amountSantim %}{{ h.amountSantim | birr }}{% else %}${DASH}{% endif %}</td></tr>{% endfor %}{% endif %}
</tbody></table>
<p><span class="term">{{ t.remarks }}:</span> {{ remarks | default: "${DASH}" }}</p>
<div class="facts">
<div><span class="term">{{ t.preparedBy }}:</span> {% if preparedBy %}{{ preparedBy }}{% else %}______________________{% endif %}</div>
<div><span class="term">{{ t.approvedBy }}:</span> {% if approvedBy %}{{ approvedBy }}{% else %}______________________{% endif %}</div>
</div>
<div class="foot" data-rules>
<p>{{ t.ruleErasure }}</p>
<p>{{ t.ruleValid }} {{ validUntil | ethdate }} {{ t.ruleValidEnd }}</p>
<p>{{ t.ruleVoid }}</p>
</div>
{% if header.stamp %}<img class="stamp" src="{{ header.stamp }}" alt="">{% endif %}${QR}`
        }
    },
    {
        key: 'vehicle-transfer-covering-letter',
        name: t('የተሽከርካሪ ማስተላለፊያ ማሳወቂያ ደብዳቤ', 'Vehicle transfer covering letter'),
        version: {
            paper: 'A4',
            dataSchema: 'vehicle-transfer-covering-letter.v1',
            strings: {
                title: t('የተሽከርካሪ ዝውውር ማሳወቂያ ደብዳቤ', 'Vehicle transfer covering letter'),
                to: t('ለ', 'To'),
                number: t('ቁጥር', 'No.'),
                issuedOn: t('ቀን', 'Date'),
                caseNumber: t('የጉዳይ ቁጥር', 'Case number'),
                validUntil: t('ደብዳቤው የሚያገለግለው እስከ', 'This letter stands until'),
                subject: t('ጉዳዩ', 'Subject'),
                subjectText: t('የተሽከርካሪ ዝውውር ስለማሳወቅ', 'Notice of a vehicle transfer'),
                plate: t('የሰሌዳ ቁጥር', 'Plate'),
                chassis: t('የሻሲ ቁጥር', 'Chassis number'),
                makeModel: t('ሰሪና ሞዴል', 'Make and model'),
                owners: t('የተሽከርካሪው ባለቤት', 'Owner of the vehicle'),
                documentNumber: t('የመረጃ ማስተላለፊያ ሰነድ ቁጥር', 'Vehicle data transfer document no.'),
                ask: t(
                    'ከላይ የተመለከተው ተሽከርካሪ ወደ መሥሪያ ቤታችሁ እንዲዛወር ተለቋል። ባለቤቱ ከዚህ ደብዳቤ ጋር የተያያዘውን የመረጃ ማስተላለፊያ ሰነድ ይዞ ይቀርባል፤ እባካችሁ ተሽከርካሪውን መዝግባችሁ ተቀበሉ።',
                    'The vehicle above is released to your office. The owner will bring the vehicle data transfer document that goes with this letter; please register the vehicle and receive it.'
                ),
                signature: t('የሰጪው ባለሥልጣን ፊርማ', "Issuing officer's signature")
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.number }}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.issuedOn }}:</span> {{ issuedOn | ethdate }}</div>
<div><span class="term">{{ t.caseNumber }}:</span> {{ caseNumber }}</div>
<div><span class="term">{{ t.validUntil }}:</span> <span data-valid-until>{{ validUntil | ethdate }}</span></div>
</div>
<p><span class="term">{{ t.to }}:</span> {{ addressee }}</p>
<p><span class="term">{{ t.subject }}:</span> {{ t.subjectText }}</p>
<div class="facts">
<div><span class="term">{{ t.plate }}:</span> {{ vehicle.plate }}</div>
<div><span class="term">{{ t.chassis }}:</span> {{ vehicle.chassisNumber }}</div>
<div><span class="term">{{ t.makeModel }}:</span> {{ vehicle.make }} {{ vehicle.model }}</div>
<div><span class="term">{{ t.documentNumber }}:</span> <span data-document-number>{{ documentNumber | default: "${DASH}" }}</span></div>
</div>
<p><span class="term">{{ t.owners }}:</span> {% for o in owners %}<span data-owner>{{ o.name }}</span>{% unless forloop.last %}, {% endunless %}{% endfor %}</p>
<p>{{ t.ask }}</p>
<p class="foot">{{ t.signature }}: ______________________</p>
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
    },
    {
        key: 'remittance',
        name: t('የገቢ ማስገቢያ ሪፖርት', 'Remittance'),
        version: {
            paper: 'A4',
            dataSchema: 'remittance.v1',
            strings: {
                title: t('የገቢ ማስገቢያ ሪፖርት', 'Remittance of revenue'),
                number: t('ቁጥር', 'Number'),
                preparedOn: t('የተዘጋጀበት ቀን', 'Prepared on'),
                period: t('ጊዜ', 'Period'),
                to: t('እስከ', 'to'),
                account: t('የሂሳብ ኮድ', 'Account code'),
                category: t('የበጀት ዓይነት', 'Budget category'),
                name: t('የሂሳብ ስም', 'Account name'),
                receipts: t('ደረሰኞች (ብር)', 'Receipts (Birr)'),
                reversals: t('ተመላሽ (ብር)', 'Reversals (Birr)'),
                net: t('ልዩነት (ብር)', 'Net (Birr)'),
                byDefault: t('በነባሪ ሂሳብ የተመዘገበ፤ ይመርመር', 'Booked to the default account: to be reviewed'),
                total: t('ጠቅላላ ገቢ', 'Total revenue'),
                cash: t('ጥሬ ገንዘብ', 'Cash'),
                bankSlip: t('የባንክ ማስያዣ (ቀድሞ ባንክ ያለ)', 'Bank deposit slips (already in the bank)'),
                reversalTotal: t(
                    'ከቆጠራ በኋላ የተሰረዙ ደረሰኞች (ፋይናንስ ይመልሳል)',
                    'Reversed after the till was counted (Finance refunds)'
                ),
                depositDue: t('ወደ ባንክ የሚገባ', 'To deposit at the bank'),
                difference: t('የቆጠራ ልዩነት', 'Counting difference'),
                sessions: t('የተሸፈኑ የገንዘብ ተቀባይ ቀናት', 'Cashier days covered'),
                day: t('ቀን', 'Day'),
                float: t('መነሻ ገንዘብ', 'Opening float'),
                expected: t('የሚጠበቅ', 'Expected'),
                counted: t('የተቆጠረ', 'Counted'),
                lines: t('የደረሰኝ መስመሮች', 'Receipt lines'),
                receipt: t('ደረሰኝ', 'Receipt'),
                item: t('ዝርዝር', 'Item'),
                amount: t('መጠን (ብር)', 'Amount (Birr)'),
                reversalLine: t('ተሰርዟል', 'Reversed'),
                demo: t('የማሳያ ሰነድ፤ የሂሳብ ኮዶች ጊዜያዊ ናቸው', 'Demo document: the account codes are placeholders')
            },
            body: `${STYLE}${HEAD}<p class="title">{{ t.title }}</p>
<div class="facts">
<div><span class="term">{{ t.number }}:</span> <span data-number>{{ number }}</span></div>
<div><span class="term">{{ t.preparedOn }}:</span> {{ preparedOn | ethdate }}</div>
<div><span class="term">{{ t.period }}:</span> {{ periodFrom | ethdate }} {{ t.to }} {{ periodTo | ethdate }}</div>
</div>
<table><thead><tr><th>{{ t.account }}</th><th>{{ t.category }}</th><th>{{ t.name }}</th><th class="num">{{ t.receipts }}</th><th class="num">{{ t.reversals }}</th><th class="num">{{ t.net }}</th></tr></thead><tbody>
{% for g in groups %}<tr><td>{{ g.accountCode }}</td><td>{{ g.budgetCategory }}</td><td>{{ g.accountName | text }}{% if g.mappedByDefault %} <span data-by-default>({{ t.byDefault }})</span>{% endif %}</td><td class="num">{{ g.receiptSantim | birr }}</td><td class="num">{{ g.reversalSantim | birr }}</td><td class="num">{{ g.totalSantim | birr }}</td></tr>{% endfor %}
<tr><th colspan="5">{{ t.total }}</th><th class="num">{{ revenueTotalSantim | birr }}</th></tr>
</tbody></table>
<div class="facts">
<div><span class="term">{{ t.cash }}:</span> {{ cashSantim | birr }}</div>
<div><span class="term">{{ t.bankSlip }}:</span> {{ bankSlipSantim | birr }}</div>
<div><span class="term">{{ t.reversalTotal }}:</span> {{ reversalSantim | birr }}</div>
<div><span class="term">{{ t.difference }}:</span> {{ differenceSantim | birr }}</div>
<div><span class="term">{{ t.depositDue }}:</span> <span data-deposit-due>{{ depositDueSantim | birr }}</span></div>
</div>
<p class="term">{{ t.sessions }}</p>
<table><thead><tr><th>{{ t.day }}</th><th class="num">{{ t.float }}</th><th class="num">{{ t.expected }}</th><th class="num">{{ t.counted }}</th></tr></thead><tbody>
{% for s in sessions %}<tr><td>{{ s.businessDay | ethdate }}</td><td class="num">{{ s.openingFloatSantim | birr }}</td><td class="num">{{ s.expectedCashSantim | birr }}</td><td class="num">{{ s.countedSantim | birr }}</td></tr>{% endfor %}
</tbody></table>
<p class="term">{{ t.lines }}</p>
<table><thead><tr><th>{{ t.receipt }}</th><th>{{ t.item }}</th><th>{{ t.account }}</th><th class="num">{{ t.amount }}</th></tr></thead><tbody>
{% for l in lines %}<tr><td>{{ l.receiptNumber }}{% if l.kind == "reversal" %} ({{ t.reversalLine }}){% endif %}</td><td>{{ l.lineKey }}</td><td>{{ l.accountCode }}{% if l.mappedByDefault %} *{% endif %}</td><td class="num">{{ l.amountSantim | birr }}</td></tr>{% endfor %}
</tbody></table>
{% if header.stamp %}<img class="stamp" src="{{ header.stamp }}" alt="">{% endif %}
{% if demo %}<p class="foot"><span class="demo">{{ t.demo }}</span></p>{% endif %}${QR}`
        }
    }
];
