/**
 * The back-capture of a paper vehicle file (ADR-0054, task 1.13): a vehicle with no electronic record is captured from its paper
 * file in back-capture mode before any service acts on it, and a second person verifies the capture before the vehicle joins the
 * register. The register is the vehicles slice's; this is the competency work process's service over it.
 */
export const BACK_CAPTURE_EFFECTS = {
    checkBackCapture: 'competency.checkBackCapture',
    backCaptureVehicle: 'competency.backCaptureVehicle'
} as const;

/** The service's code in the catalogue: not one of the bureau's 54, the migration's own. */
export const BACK_CAPTURE_SERVICE = 'MIG-01';
