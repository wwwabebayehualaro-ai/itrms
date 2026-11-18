/**
 * A vehicle arriving from another region (task 1.4c3, DVC-17, ADR-0060): registered on the vehicle data transfer document its owner
 * brought, with the strict checks of a new registration. Nothing is fetched from the other side: the officer checks the document, on
 * its issuer's verification page or by letter, and the register keeps what it says. A vehicle with a plate the region has retired
 * is given a national plate from the office's stock in the same case (the plate exchange of Directive 1050/2025), when the region
 * asks for it.
 */
export const TRANSFER_ARRIVAL_EFFECTS = {
    checkTransferArrival: 'competency.checkTransferArrival',
    /** the giving step: the vehicle joins the register on its document, its owners from the day the document gives */
    registerArrival: 'competency.registerArrival',
    /** the registration certificate: this office numbers it from its own counter */
    issueArrivalCertificate: 'competency.issueArrivalCertificate'
} as const;

/** The service's code in the catalogue. */
export const TRANSFER_ARRIVAL_SERVICE = 'DVC-17';

/**
 * Whether a vehicle that arrives on an old regional plate is given a national plate from the office's stock in the same case. On
 * until the region says otherwise (Directive 1050/2025: a region's old plates are exchanged); the case freezes it when it is filed.
 */
export const VEHICLE_TRANSFER_PLATE_EXCHANGE_SETTING = 'competency.vehicle_transfer_plate_exchange';
