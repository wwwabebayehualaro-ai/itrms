# @itrms/competency

Driver and vehicle competency: driver licences, bolo inspections and the competency services.

**Licence numbers, the card serial and the blood group (task 1.6, ADR-0051, ADR-0052, ADR-0064).** A licence is numbered when the
national platform accepts it, in the worker's system transaction (`competency.activateLicence`, `api/licence-numbers.ts`): the
platform's number when it gives one (no counter moves), else the next value of the region's one counter `competency.licence` on its
root unit, pattern `<region code>-{seq:05}` ("06-00001"). The region setting `competency.licence_number` (`{ scope, regionCode,
firstNumber }`, installation or region, sensitive; default scope `region`) decides; scope `unit` keeps each office's
`{unit}/DL/{seq:06}`. The counter is set up by `seed competency` (`setUpLicenceCounters`, as the owner) after the first number minus
one, and that step refuses a region in scope `region` without its code and first number; set the setting first (`seed settings`),
and run `seed competency` again after changing it (a counter is never lowered, a number never renumbered). Filing a new licence
(`competency.checkApplication`) asks the reviewed definer `kernel.regional_counter_ready('competency.licence')` (only that key,
only the caller's region) and refuses with 409 `not_configured` while the counter is missing. The serial printed on the card is kept
on `driver_licences.card_serial` when a printed batch is recorded, in the same transaction (`RegisterService.recordPrinted`),
unique in the region (409 `competency.errors.card_serial_taken`), and filters the register (`GET /competency/licences?cardSerial=`).
The blood group (`competency.licence_health`, class R, field-encrypted, never in the audit log) is recorded by `POST
/competency/licences/:id/health` (`licence-health:record`: officer and lead; 409 while `competency.card_shows_blood_group` is off)
and read in clear only by `POST /competency/licences/:id/health/reveal` (`licence-health:reveal`: the lead; a reason, a second
factor in the last five minutes, rate-limited, never replayed; the `licence.health_revealed` event is recorded before the read; a
licence outside the lead's subtree is 404). Views, lists, the lookup and the card document carry only `bloodGroupOnRecord`.

**The back-capture of a paper driver licence (MIG-02, task 1.6b, ADR-0054, ADR-0064 §6).** Seeded as configuration
(`seed/licence-capture-service.ts`): a clerk files the paper licence's facts and its scan; a second person (`separationOfDuties:
['draft']`) verifies against the paper (`competency.captureLicence`) or flags the number (`competency.flagLicenceNumber`). A verified
capture joins `driver_licences` with its printed number and card serial, `migration_source = 'back_capture'`, the verifier and the
case (insert only: the columns take no UPDATE grant), active with no national reference until task 1.14 reconciles it. Under the
number's lock and then the holder's (the same per-grade key a first licence's issuance takes) it is checked again: one licence per
person, and a number neither in the region's reserved range (`competency.licence_number`, or an office's `{unit}/DL/{seq:06}`) nor on
another licence of the region, voided ones too. Such a number is never renumbered: the second person flags it, with a reason, to
`competency.licence_number_flags` (class T at the capturing office, insert only), which the offices above read at `GET
/competency/licence-number-flags` (`licence:read`) with that reason (the flag transition's comment, which effects receive as
`EffectRun.comment`). The region setting `competency.licence_capture_expired` (installation or region, sensitive) decides which expired
paper licences are taken: `accept` (default: Proclamation 1074/2018 Art. 19 keeps an expired licence renewable, with a practical exam
once over a year late), `refuse_late` (refuse those over a year late) or `refuse`. A taken expired licence carries the case notices
`competency.licenceCapture.expired` and, over a year late, `competency.licenceCapture.renewalNeedsExam`. The licence register's empty
search offers the back-capture where MIG-02 is offered, to who files (`case:create`); a reader who does not file is told the records
officer captures it. The records officer reads the register through the module's role grant (task 1.6b2, ADR-0065):
`competency.intake_reads_licences` (installation, region or unit type, sensitive; on by default) gives `records_officer`
`licence:read`, so the desk looks a licence up, and finds a paper one missing, before it files.

**New vehicle registration (DVC-01, task 1.2b).** Seeded as configuration (`seed/vehicle-services.ts`): the request form
`vehicle-registration` (owners, the vehicle's facts, documents, the fee), the step form `vehicle-national-entry` (the federal
vehicle id, keyed in by staff until a national interface exists), the workflow draft → review → payment → approval →
registration → booklet → registered, the fee rule `dvc-01-registration` (demo amounts) and the
`vehicle-registration-certificate` template (the zone's temporary libre). The effects
(`api/registration.effects.ts`, run by `VehicleRegistrationService`) call the vehicle register and the plate stock: check the
chassis at submit (a binding check-digit failure only when the officer confirms it, recorded as a `vinCheck` mismatch), hold a
plate from the handling unit's stock at the lead's approval, give it back on rejection, and at registration make
the vehicle with its first ownership, assign the held (or a named) plate, and issue the libre with its registration
certificate, numbered from the office's counter. The last step (task 1.2d, ADR-0050; step form `vehicle-libre-booklet`) writes the
libre in a federal booklet from the office's stationery (`StationeryStock.use`: the named one or the next; the booklets spoiled on
the way recorded with their reasons) and issues the certificate again with its serial, the temporary one superseded. With no
booklet in stock the case waits in that step. Each effect is idempotent per case. The service needs the `holds_plate_stock`
and `holds_stationery` capabilities of the handling unit.

**The plate exchange (DVC-12, task 1.2c, Directive 1050/2025).** Not in the source list: the plates part of DVC-01 as its own
service, offered where vehicles are registered (`holds_plate_stock`). Seeded as configuration (`seed/exchange-service.ts`): the
form `vehicle-plate-exchange` (the vehicle picked from the register, its use, the owner's identity and the libre as attachments,
the fee), the step form `vehicle-plate-handover` (the federal vehicle id the national system gave, the plate handed over if not
the held one), the workflow draft → review → payment → approval → exchange → exchanged, and the demo fee rule
`dvc-12-plate-exchange` (the zone's plate fees by use). `competency.checkPlateExchange` refuses a vehicle not active, handled by
another office, already on a national plate, a use that is not the register's, and a second open request; the plate is held
and released by the registration's effects; `competency.exchangePlate` records the federal id and puts the plate on the vehicle,
the old plate retired and linked to it. A vehicle not on the register is back-captured first (MIG-01).

**The replacement of a lost, stolen or damaged libre (DVC-06, task 1.5, ADR-0062).** Part 1 of three: the frame and the libre
(the bolo sticker is 1.5b, the plate 1.5c; the request's `item` offers only `libre` until then). Seeded as configuration
(`seed/replacement-service.ts`): the form `vehicle-replacement`, the workflow draft → review → notice (a lost or stolen libre only)
→ payment → approval → libre → booklet, with `vehicles.checkEncumbrances:replacement` before each step that moves it on, and the
demo fee rule `dvc-06-replacement` (libre 1,500, bolo 1,500, plate 1,000 plus the plate's own price: placeholders). A lost or
stolen libre needs the police letter's number and date and a newspaper notice; the notice step is left by the officer no earlier
than the publication day plus `competency.libre_notice_days` (15, sensitive), which `competency.checkReplacementNotice` and
`competency.replaceLibre` check (the workflow counts business days only). `replaceLibre` makes the libre in force `lost` (`replaced`
if damaged), issues the same owners' new libre pointing at it, supersedes the old certificate by one for the new libre
(`documents.supersede` with the new libre as its subject) and writes `competency.replacements` (migration 0092, class T); the
booklet is the registration's own step. The case's facts hold `replacement.vehicleId`, which `competency.vehicle_in_open_case`
reads. Offered where DVC-01..17 are, with `holds_stationery`.

**The bolo sticker (DVC-06, task 1.5b).** The request's `item` now offers `bolo` as well (a new version of the form and the flow;
a seeded service moves to it on re-seed, a bureau's own version is left alone). A bolo goes review → payment → approval → `bolo`
(step form `vehicle-bolo-sticker`) → replaced: no notice, and **no hold check**, since a hold is about the title, not roadworthiness.
So that a hold still stops a libre at filing, `ReplacementService.check` calls the encumbrance check for a libre itself (the filing
transitions no longer name `vehicles.checkEncumbrances:replacement`, which cannot tell the items apart). Filing needs a bolo in
force on its sticker (`valid`, last day not past; an expired bolo goes to a new inspection, DVC-02; a temporary bolo or one awaiting
its sticker is refused) that the case's office issued: a registry record is written only by its handling office, and the bolo document
is that office's, so a vehicle that moved since is refused (`bolo_other_office`) and replaced where the bolo was issued. A damaged
sticker is handed in, a lost or stolen one has the police letter. `competency.replaceBoloSticker` takes the next sticker of the
bolo's use and year from the office's stationery (used for the replacement row, not for the bolo, so the old sticker is not handed
back; no stock refuses the step and the case waits), sets `bolos.sticker_key` (same fiscal year and last day), keeps the old and new
keys on `competency.replacements`, and reissues the `vehicle-bolo` document with the new sticker as its number, so the old QR reads
superseded. The old sticker's stock item stays `used` (the stock has no status to move a used item to).

**The plate (DVC-06, task 1.5c).** `item` offers `plate` (a new version of the form and the flow). Review → payment (holds checked,
no notice) → approval (`competency.reserveRegistrationPlate` holds a plate of the office's stock, so the service needs
`holds_plate_stock`) → `plate` (step form `vehicle-plate-handover`, as DVC-01 and DVC-12) → replaced; a rejection from `plate`
releases the held plate. Filing needs a plate the vehicle carries now (national or an old regional one; a special plate is
refused), the police letter (lost, stolen) or the old plate handed in (damaged), and a vehicle with no hold. `competency.replacePlate`
gives a NEW national plate with a NEW number from the stock (a lost old regional plate also gets a national plate, Directive
1050/2025) through `VehicleRegistrationService.assignPlate` with `endedReason`: the old assignment ends `lost`, `stolen` or
`damaged`; in the stock a lost or stolen plate reads `lost`, a damaged one `retired` (handed in); an old regional plate has no stock
row. A plate key is one pair, so the pair is replaced as a whole and the register holds one number. The vehicle must still carry
the plate the request was checked with. Then the registration certificate of the libre in force and the bolo document (both print
the plate) are issued again; run again the step only reads. If the standing certificate was issued by another office (the vehicle
moved since), the replacing office cannot see it, and cannot issue a second for the same libre (one document of a record stands
at a time): the reviewed `vehicles.supersede_libre_certificate` (migration 0093) supersedes it by the id of the new one, which keeps
the old number and language and is issued at once under the replacing office, the change audited as `documents.superseded_across`.
A bolo document another office issued is left as it was (no cross-office command for it, as for the sticker).

**The ownership transfer (DVC-13, task 1.4b).** Not in the source list: the change of a vehicle's owner (ስም ዝውውር) by sale, gift,
inheritance, court order or auction, offered wherever DVC-01 is (`holds_stationery`: it issues a libre). The sellers are the
register's current owners; the request names the buyers. Seeded as configuration (`seed/transfer-service.ts`): the form
`vehicle-ownership-transfer`, the step forms `vehicle-transfer-valuation`, `-letters` and `-evidence` (and the libre booklet's own),
the workflow draft → review → valuation (a `competency.inspector`) → letters → outside (the authenticated contract and the
receipts) → payment → approval → transfer → booklet, with `vehicles.checkEncumbrances:ownership-transfer` before each step that
moves it on, and the demo fee rule `dvc-13-ownership-transfer` (name change 1,000 and a new libre 2,000: the zone's fee sheet, to
confirm). `competency.checkOwnershipTransfer` refuses a vehicle not active or handled by another office, buyers who already hold
it, an office with no number series (the certificate's and the letters'), and any other open request on the vehicle (the case's
facts hold `transfer.vehicleId` from its submission until it closes, which `competency.vehicle_in_open_case` reads: it refuses a
plate exchange and a second transfer; a bolo and the recording of a hold are not blocked). `recordValuation` keeps the committee's
figures in whole Birr as santim (`competency.ownership_transfers`, class T at the handling office) and refuses a vehicle that does
not match its paper inspection. `issueTransferLetters` writes the revenue letter (the valuation, no duty), the justice letter (a
sale or a gift: authenticate the contract; the vehicle has no hold) and, for a code-3 vehicle, the tax letter, each numbered from
`competency.transfer-letter` (`{unit}/OT/{seq:05}/{efy}`) and standing `competency.transfer_letter_valid_days` (30); a letter that
expired is issued again with the next number after a return from `outside` (the old one superseded). `recordTransferEvidence` refuses
(422 `letter_expired`) a contract or stamp duty receipt dated after the letter it answers stopped standing, unless the region sets
`competency.transfer_letter_validity_enforced` to false (task 1.4b3). The payment timeout revokes the letters. `transferOwnership`
ends the sellers' period, begins the buyers', cancels the old libre and revokes its certificate, issues the new libre and its
certificate and refuses (409 `owners_changed`) a vehicle whose owners changed since the filing. Assumptions, to confirm with a
bureau: a new booklet on every transfer, the demo fees, the 30-day letter validity and its binding the papers, and that ITRMS never computes a tax or a duty
(the revenue office determines the stamp duty on the value the committee set). Deferred: publish-time rules for required effects
(task 1.4b2) and the pre-1981 chassis identity (task 1.13j).

**The transfer of a vehicle between offices (DVC-14 and DVC-15, task 1.4c, ADR-0057).** Seeded as configuration
(`seed/vehicle-transfer-service.ts`). DVC-14, filed where the vehicle is handled with the office it goes to (the `office` lookup:
offices of the region given DVC-15), runs draft → review → payment → approval (lead) → release; `releaseVehicle` writes the
register's handover (`vehicles.vehicle_handovers`), standing `competency.vehicle_transfer_valid_days` (15). DVC-15, filed at that
office, runs draft → review → (inspection, when `competency.vehicle_transfer_reinspect` was on at the filing) → payment (no fee by
default) → approval → receive; `receiveVehicle` calls the register's reviewed command `vehicles.accept_handover`, which moves the
vehicle, its open ownership period and owners, its current plate, its libre in force and its assigned stock plate (a
`hand_over_out` and a `hand_over_in` ledger row) and nothing closed; each moved row is an audited `vehicles.handover_moved` event.
Every step that moves either case on checks the vehicle, the owners the filing saw and the other open requests on it
(`vehicle_in_open_case` claims a vehicle on its way), and `vehicles.checkEncumbrances:zone-transfer-out` runs before both giving
steps.

**A vehicle leaving the region (DVC-14 "outside", task 1.4c2, ADR-0058).** The request's `destination` is `office` (the default,
above) or `outside` (another region, or an office without ITRMS): then `destinationName` and `destinationRegion` replace
`toOffice`, and the office needs the `competency.transfer-document` counter (`{unit}/VT/{seq:05}/{efy}`). After the lead's
approval the case goes to `document` (the step form `vehicle-transfer-document`: customs declaration and tax receipt numbers, the
purchase value and excise paid in whole Birr, earlier plates, remarks) and `issue_document` runs `releaseVehicleOut`: the register's
`VehicleHandovers.releaseOutside` writes a standing handover of kind `outside` (no receiving office; nothing can receive it) and
sets the vehicle to `transferred_out`, and nothing else changes (ownership, plate, libre and stock plate stay). It issues the
`vehicle-transfer-document` (valid `competency.vehicle_transfer_valid_days`, 15) and a `vehicle-transfer-covering-letter`, each
numbered from that counter. For an office of the region the covering letter is the setting
`competency.vehicle_transfer_covering_letter` (off). `setStatus` no longer sets `transferred_out`, and bolo reminders skip a
vehicle that is not active. A vehicle arriving from another region is DVC-17 (task 1.4c3, below).

**Cancelling a release (DVC-16, task 1.4c2b, ADR-0059).** Filed at the office that made the release (the `released-vehicle` lookup:
vehicles with a release standing from the caller's office, of either kind and whatever its day), draft → review (officer) →
approval (lead; not the filer or checker) → cancelled; no fee. `checkReleaseCancel` refuses a vehicle with no standing release
from the office, a release that changed since the filing and an empty reason; for a release to another region the number of the
transfer document handed back must match the issued one (compared trimmed, without spaces, upper-case), is required while the
document is valid, and after it lapsed may be left out unless the region sets `competency.vehicle_release_cancel_unreturned` off
(default on, sensitive). It also asks the reviewed definer `competency.release_in_open_case` whether the receiving office has an
open transfer in, or another cancellation is open (not_eligible). `cancelRelease` calls `VehicleHandovers.cancel`: the handover
becomes `cancelled` (final; migration 0088's trigger lets it only for another case of the releasing office whose facts name the
release, today, by the caller), a vehicle `transferred_out` reads `active` again (its records were kept), and the transfer
document and covering letter are revoked (their QR reads revoked). A vehicle transferred out before ADR-0058 has no handover and
cannot be brought back by DVC-16.

**A vehicle arriving from another region (DVC-17, task 1.4c3, ADR-0060).** Seeded as configuration (`seed/vehicle-arrival-service.ts`):
the form `vehicle-transfer-arrival` (DVC-01's owner and vehicle fields and the transfer document's facts, its scan required), the plate
step's form, and the workflow draft → review → [inspection when `transferArrival.reinspect`] → payment → approval → arrival →
registered, with the fee rule `dvc-17-arrival` (2,000 Birr and a plate line that follows the `takesNationalPlate` tick).
`TransferArrivalService.check` runs on filing, correction and each step that moves on. It checks:
- the document: number, region and office; its dates; valid on the day filed (frozen in `transferArrival.filedOn`); the officer's
  tick and how it was checked; used once per issuing region, also against open arrivals (`competency.arrival_in_open_case`);
- a chassis or federal id the register does not know, or the vehicle of this region that left (below);
- the registration's strict checks, and a plate no vehicle carries or carried (under the back-capture's plate lock);
- the plate rule: `takesNationalPlate` must equal an old regional plate and the setting, frozen at filing;
- the libre and the dates (`paper-records.ts`, shared with the back-capture).

`registerArrival` registers the vehicle acquired by `transfer_in`. It records the plate the vehicle carried and the federal libre, and
writes `vehicles.vehicle_arrivals` (migration 0089). With the exchange, the held national plate then replaces the old plate (ended
exchanged) through the registration's plate effects, and `issueArrivalCertificate` issues the registration certificate. A hold the
document lists is a notice only. `competency.vehicle_in_open_case` also claims the chassis and plate of an open arrival.

**The vehicle that left the region comes back (task 1.4c3b, ADR-0060 point 8).** A chassis that names a `transferred_out` vehicle of this
region is a return, on its own record (`facts.transferArrival.returning`). Refused while this region's release outside is valid
(`arrivalReleaseStanding`: DVC-16 at the releasing office) and with no open ownership period (`arrivalNoOwnersOnRecord`). `registerArrival`
calls the reviewed command `vehicles.accept_return` (migration 0090; `VehicleArrivals.acceptReturn`): the record goes active at the case's
office with its live rows (and the stock plate, with ledger rows) when that is another office, and the release ends `returned` (final).
Then only what differs changes the register: other owners (`VehicleRegistry.returnOwners`: transfer in from `ownersSince`, which is
required), a plate of another region (the old one ended `transferred`; a plate of the vehicle's own past is refused), a libre other than
the one in force. Make, model, year or use that differ, and holds still on the record, are notices. The exchange rule and the
certificate run as for a new arrival; the arrival row has `returned` and the release. DVC-16 and DVC-17 refuse each other while one is open.

**The back-capture of a paper vehicle file (MIG-01, task 1.13, ADR-0054).** Not one of the bureau's 54 services: the migration's
own, offered where vehicles are registered. Seeded as configuration (`seed/back-capture-service.ts`): the form
`vehicle-back-capture` (the paper file's reference and its scan, both required; the registration's owner and vehicle fields; the
file's dates in the Ethiopian calendar; the plate it carries and the libre it holds), the workflow draft → verification → captured,
no fee. `competency.checkBackCapture` checks the capture in back-capture mode when it is filed or corrected (the dates in order, a
plate no vehicle carries and not in the stock, no other open request for the chassis or plate). The verification step keeps
whoever captured the file off it (separation of duties); `competency.backCaptureVehicle` then registers the vehicle as migrated,
verified by the actor, with its plate and libre. Until then the vehicle is not on the register, so no service can act on it.
The vehicle search offers the back-capture when it finds nothing (capture on touch).

**The bulk import of paper vehicle files (task 1.13b, ADR-0054).** The backlog's other road in: a sheet of paper files (CSV or an
Excel workbook, the template's columns in `contracts/vehicle-import.ts`), one row per file, sent with the files' scans to
`POST /api/v1/vehicle-imports` by an office that offers MIG-01. It never runs in the request: the worker reads it
(`vehicle-import.check-requested.v1`, `import-sheet.ts`: a workbook's unpacked size is bounded before ExcelJS opens it) and checks
every row as a back-capture is checked (`import-rows.ts` for the cells, then `BackCaptureService.check` in back-capture mode): the
dry run, whose report gives each row's errors at their columns. A paper file, chassis, plate, libre or scan twice in the sheet is
an error on the later row; a chassis already on the register from an import with the same paper reference is `already_imported`,
so a sheet sent again makes nothing. A second person, never the sender (SEC-AC-6), commits it (`vehicle-import:commit`); the worker
then puts each valid row on the register in its own transaction as migrated by `import` (`vehicles.migration_import_row_id`, the
committer its verifier), with its plate and libre. Owners: a person by FIN, else made at the commit, the rows of one owner (one
FIN, or one Amharic name with one phone) one person; a possible duplicate on the register is an error for a person to resolve; an
organisation must be on the register (its TIN). The sheet is kept field-encrypted only until it is read; an owner's phone and FIN
are encrypted in the row. Both jobs run on the app's pool as the person who asked, with the roles they still hold. The vehicle
keeps its batch and the file's name (`vehicles.migration_import_id`, `migration_import_name`), shown in the search, the record and
the lookup. A commit whose job died after all its attempts (its outbox event `dead`, `vehicle_imports.commit_event_id`) is given
back to checked by someone who may commit (`POST …/give-back`), never while the job is alive; what it committed stays. The
campaign counters are task 1.13i.

**Sampling QA (task 1.13g, ADR-0054 §3).** When a paper file joins the register (a back-capture verified, or a sheet's row
committed), the record counts to its clerk at the capturing office (the case's starter, or the sheet's sender) and the share
(`competency.migration_sample_percent`, default 5, to agree with the zone; set by the bureau or for a kind of office, never by the
office measured) is drawn, in the same transaction
(`api/migration-sampling.service.ts`, `api/sampling.ts`): p percent is k of every block of n records (k/n = p/100 in lowest terms:
5% is 1 in 20), the k places chosen at random when the block opens, so every complete block draws exactly k and the draw cannot be
foreseen (the places, and where in its block a clerk stands, never enter the audit log; a clerk sees neither their own records
waiting for a re-check nor their own counts). A clerk's draws at an office are one after another (an advisory lock, then the
counter's row); a share changed opens a new block at the next record, and a clerk with fewer records than a block may have none
drawn yet. A drawn record (`migration_samples`, class T) is re-checked against its scan by a third person, never its clerk nor its
verifier (`migration-sample:recheck`; the database refuses it too): correct, or the facts found wrong, once. A re-check measures:
it never changes the vehicle (a correction is a service of its own). `GET /api/v1/migration-samples/clerks` counts each clerk's
records, draws, re-checks, re-checks with errors and errors; in a two-person office the re-check is done from the office above.
A drawn record keeps every page of its scan (`scan_file_ids`, at most 20, the first also in `scan_file_id`); the re-check opens
each page through its own short-lived link, `POST /api/v1/migration-samples/:id/scans/:fileId` (404 for a file that is not one of
the sample's pages; every download is on record).

**Reconciliation report (task 1.13h, ADR-0054 §4).** `GET /api/v1/migration-report` (`migration-report:read`) measures the
migration per office the caller's active unit holds, against the zone's own count of the paper files on the shelves
(`api/migration-report.service.ts`, arithmetic in `api/reconciliation.ts`; typed tables only, never the JSONB answers). Definitions:
- *Plate code group*: `PAPER_PLATE_CODES` = `1, 2, 3, 4, 5, 35, other`, the use code of the old regional plate that paper files are
  shelved by. A migrated vehicle's code is the `legacy_use_code` of its earliest plate assignment (by `since`, then `created_at`);
  the six use codes map to themselves, anything else (a national or special plate, no plate, another code) is `other`.
- *Verified*: vehicles on the register with `migration_source` set (both sources always carry a verifier), counted at the vehicle's
  `handling_unit_id`, per code. A later transfer moves the vehicle, and so its count, to the new office (transfers: task 1.4).
- *Awaiting*: captured, the second person not done; only per office, not per code (a capture's plate is in the typed tables only once
  verified). It is the open MIG-01 cases at the office (the case's frozen `serviceCode`, not closed: drafts and submitted
  captures alike) and the `valid` rows of that office's sheets in state `checked` or `committing`.
- *Paper*: the zone's count for an office and code (`migration_paper_counts`, class T at the counted office), none when not entered.
  *Missing* = max(paper - verified, 0), none without a paper count. *Share* = verified over paper, summed over the codes that have a
  paper count (none if no code has one, or the paper total is 0): the phase gate's migrated share. The sums of an office and the
  report's total use the same rule.
`PUT /api/v1/migration-report/paper-counts` (`migration-report:count`, the roles that may re-check samples) sets a count: the caller's
active unit must be a strict ancestor of the office (an office never sets its own target: 403
`competency.errors.paper_count_own_office`; an office outside the caller's subtree is 404). A new count carries no `If-Match`; a
change carries the count's version (otherwise 409 `stale_version`). The register is read region-wide by RLS, so the report limits
its vehicle query to the caller's subtree by hand.

**Campaign counters (task 1.13i, ADR-0054 §2).** A unit runs a *campaign* over a span of days, sets a target for each office below it,
and the dashboard shows each office's daily count against its target (plate exchange, task 1.2c; bolo season, task 1.3). Typed tables
only, never the JSONB answers (`api/campaign.service.ts`, arithmetic in `api/campaigns.ts`). Definitions and assumptions:
- *Kinds*: `CAMPAIGN_KINDS` = `plate_exchange`, `bolo_season`. A campaign is `competency.campaigns` (name as `I18nText`, `starts_on`,
  `ends_on`, `closed_at`); at most 366 days (checked in the contract and the migration, 0081).
- *What counts*, per office (`handling_unit_id`) per Gregorian day in Africa/Addis_Ababa, only within `[starts_on, ends_on]`:
  `plate_exchange` = `vehicles.plate_assignments` with `ended_reason = 'exchanged'` on their `until` day (the day the old regional
  plate gave way to the national one, task 1.2c); `bolo_season` = `competency.bolos` on `inspected_on`, not `void`. An office is the
  handling unit of the counted row. The registers are class R (read region-wide), so every count is limited by hand to the caller's
  subtree and to the campaign unit's subtree (`handling_org_path <@ kernel.ctx_scope()`): a sibling office never sees another's count.
- *Target*: `competency.campaign_targets` (class T at the office, unique per campaign and office, 1 to 10,000,000, set by a unit above
  the office, never by the office itself: database CHECK `set_by_unit_id <> handling_unit_id`).
- *Progress* per office with a target or a count: `today` (the count on today's Addis day), `total` so far, the last 14 days
  zero-filled, and `expected` = round(target x elapsed days / campaign days). Both end at the counting end = min(`ends_on`, the Addis
  day of `closed_at`, today): a closed campaign stops counting at its closing day (that day counts, the days after do not), and
  elapsed days run from `starts_on` to that end inclusive (0 before the start). `onTrack` = total >= expected (an even pace is
  assumed; a real season may be front- or back-loaded). The totals add the offices; target and expected add only those with a
  target, and `targetedTotal` (the total of the offices with a target) is what the totals' pace is compared with, so an office
  counted without a target does not make the whole look on track. A few grouped queries, no per-office loops.
- *How an office sees its zone's campaign*: `campaigns` is class C (config): the unit's subtree writes it, and the offices below it
  (and the unit's own subtree) read it (the running unit and the units above it write it), so a woreda sees the campaigns of every unit above it, targeting it or not; its own target
  row is class T and its subtree reads it. A sibling sees the zone's campaign and none of the other offices' targets or counts. No
  SECURITY DEFINER function is involved.
- *Rules*: any unit may run a campaign (the targets scope it). A target is only for an office that offers the service whose records
  the campaign counts (`CAMPAIGN_SERVICES`: `bolo_season` = DVC-02, `plate_exchange` = DVC-12; the unit's effective services, else
  422 `service_not_offered` on `unitId`), so a target compares an office with its own records and the totals never count a nested
  office's records twice. An open campaign of the same kind at
  the same unit may not overlap another (409 `duplicate_reference`; a closed one does not count). A target is set for an office that
  is a strict descendant of both the campaign's unit (else 422) and the caller's active unit (else 403
  `competency.errors.campaign_target_own_office`); new without `If-Match`, a change with the target's version (else 409
  `stale_version`). A closed campaign takes no target (409): a target is set under a shared advisory lock on the campaign and the
  closing takes it exclusively (a row lock would need the UPDATE policy, which a unit below the campaign's does not have), so a
  target never lands on a campaign closed at the same time. Closing (`POST /campaigns/:id/close`, `If-Match`) is for the campaign's
  unit or above (`mayClose`). The progress also lists `candidates` for a first target (only for a caller with `campaign:manage`, on
  an open campaign): the active units strictly below both the campaign's unit and the caller's, offering the service and with no
  target yet, found in one query that applies the unit type's default and the unit's override as `effectiveServices` does, at most
  300 by code. `mayManage` is true for a caller at or above the campaign's unit, or below it with a candidate or a target below
  their own unit (a town may set the targets of its own offices); `mayClose` only at or above. The count queries are served by
  the partial index on `plate_assignments (until) where ended_reason = 'exchanged'` and the index on `bolos (inspected_on)` (0082).
- API: `GET /api/v1/campaigns`, `POST /api/v1/campaigns`, `GET /api/v1/campaigns/:id` (with progress), `PUT /api/v1/campaigns/:id/targets`,
  `POST /api/v1/campaigns/:id/close`; permissions `campaign:read` (officer, lead, inspector) and `campaign:manage` (officer, lead).
  Web: `/competency/campaigns`, the detail (with "add a target" over the candidates), and the home page's `CampaignWidget` (up to
  three open campaigns, those running now first and those of the person's unit or above before those started below it; the pace
  compares `targetedTotal` with `expected`).

**Acting for the handling office, and one vehicle in one open request (task 1.2e).** The steps that write a vehicle's records
(register, the plate, the libre and its booklet, the exchange, the back-capture's verification) run for the case's handling
office: taken in it, or in an office above it when separation of duties left nobody in the office and the step was sent up the
tree (`api/handling-office.ts`, `actForHandlingOffice`). The vehicle, its plate (from the office's stock) and its libre (from
its stationery) stay the office's; any other office is refused (`competency.errors.act_from_handling_office`). Whether another
open request claims the vehicle (a registration's or back-capture's chassis, a back-capture's old plate, an exchange's vehicle)
is asked of the reviewed `competency.vehicle_in_open_case` over the whole region (migration 0073), not of the cases the filer's
office sees, so two sibling offices cannot both take a fee for one vehicle. A chassis check digit the officer confirmed does not
match is a notice on the case (`competency.notice.chassisMismatch`), shown to the lead who approves it. The claims carry the make
key of an 'other' chassis number (`makeKey` in the case facts and in the lookup's second argument, migration 0091, ADR-0061): the
lock stays on the chassis key, and a case of another make with the same text does not claim it; a claim with no make key (a real
VIN, or a case filed before 0091) claims on the chassis alone. A registration or arrival that finds another make's vehicle with
the same text carries the notice `competency.notice.chassisOtherMake`.

Layer: work-process. Shape, public entries and rules: [code-structure.md](../../docs/platform/code-structure.md) §4.

| Entry | Holds |
|---|---|
| `./manifest` | the module manifest (`module.ts`) |
| `./contracts` | Zod DTOs, events, permission keys, error codes, query interfaces (isomorphic) |
| `./api` | the NestJS module of the HTTP side (server only) |
| `./api/worker` | jobs and event handlers, loaded only by the worker processes |
| `./web/server`, `./web/client` | screens and route map; embeddable client components |
| `./messages/*` | `am`, `en`, `wal-Latn` catalogues, keys `competency.<area>.<key>` |
| `./seed` | service definitions, unit-type defaults, demo generators |

## The bolo inspection (DVC-02, tasks 1.3a and 1.3b)

A vehicle on the register is filed with its third-party insurance certificate (Proclamation 799/2013: number, insurer, policy
period; a policy that does not cover today is refused) and the papers its use needs (a public transport or freight vehicle,
plate codes 1 and 3, brings its Road Fund receipt). The fee is the zone's table by use, seats and load (demo). After payment the
officer inspects it on the light-vehicle checklist (a `Checklist` field, task 1.13a: the outcome is the server's), with the
sheet's own serial: `pass` is refused unless the checklist passed (a failed item blocks it), `fail` sends the vehicle to a
garage. A pass makes the vehicle's bolo, `competency.bolos` (class R: the region reads it, the handling office's subtree writes
it), valid to Sene 30 of the fiscal year it was inspected in. The officer then hands over the sticker of the vehicle's use and
that fiscal year from the office's stationery (the bolo document carries its serial), or, only while the office has none, a
temporary bolo numbered from the office's counter (`{unit}/TB/{seq:05}`) for the office's `competency.bolo_temporary_days` (30
by default), and the sticker later on the same case; the temporary bolo's document is revoked when the sticker is given or the
case is rejected. A vehicle has one bolo per fiscal year.

**Re-inspection after a garage (task 1.3b).** A failed vehicle waits in the `repair` step (30 business days, then overdue). When
it comes back, the officer records the garage (an organisation of kind `garage`, the `garage` lookup), the day and the repair,
and the vehicle is inspected again on the same case and its paid fee; one that does not come back is closed as `failed` with a
comment. A re-inspection stays in the fiscal year of the failure: once the year has ended, the repair is refused and the request
is closed as failed (a new request is filed for the new year). Every inspection, passed or failed, is a row of the inspection register `competency.bolo_inspections` (class T, written
once): attempt, sheet serial, day, result, failed items with their remarks, and the garage and repair before it.

**Renewal reminder (task 1.3b).** When the sticker is given, a `bolo.expiring.v1` event is written to the outbox, due
`competency.bolo_reminder_days` (30 by default) before the bolo's last day at 08:00 Addis Ababa time (none for a bolo given
inside that window). When it comes due, the worker marks the bolo (`bolos.reminded_at`, once) and writes one
`bolo-reminder.sms-due.v1` per owner of the open ownership period; each sends that owner an SMS in Amharic with the plate and the
last day, reading the phone through the parties register's worker-only `phoneForNotice` (each read recorded as
`person.revealed`), and is retried alone when the gateway fails. Organisations as owners get none until the register keeps their
contact. Both settings are read when the step runs (ADR-0047), not frozen with the case.
