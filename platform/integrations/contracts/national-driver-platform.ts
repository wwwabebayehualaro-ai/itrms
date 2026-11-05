/**
 * The national driver platform (MoTL's digital driver registration and certification; ethiopia-context.md §3, architecture.md §16). No
 * public interface is known yet, so this is what ITRMS needs of one, and a fake answers it. A real adapter implements the same
 * interface and passes the same contract tests. ITRMS never holds a competing value: it keeps this platform's reference.
 *
 * Only what the platform needs goes out: no Fayda number and no full birth date, until an agreement says otherwise.
 */
export interface NationalLicenceRequest {
    /** the same request gets the same answer: a retry never makes a second licence */
    requestId: string;
    kind: 'new' | 'renewal';
    licenceId: string;
    personId: string;
    name: string;
    birthYear: number | null;
    sex: 'female' | 'male';
    officeCode: string;
    grades: readonly string[];
    /** a renewal's existing number and reference */
    number: string | null;
    nationalReference: string | null;
}

export type NationalLicenceAnswer =
    | {
          status: 'accepted';
          reference: string;
          /** when the platform issues numbers itself; until then the region's counter gives one */
          licenceNumber: string | null;
          reason?: undefined;
      }
    | { status: 'rejected'; reference: string; reason: string; licenceNumber?: undefined }
    /** it will answer later: nothing moves yet */
    | { status: 'pending'; reference: string; licenceNumber?: undefined; reason?: undefined };

export interface NationalLicenceStatus {
    reference: string;
    status: 'pending' | 'active' | 'rejected';
}

export interface NationalPrintRequest {
    batchId: string;
    licences: readonly { licenceId: string; number: string | null; reference: string | null }[];
}

export interface NationalDriverPlatform {
    requestLicence(request: NationalLicenceRequest): Promise<NationalLicenceAnswer>;
    /** The platform's status of a licence it knows; nothing for a reference it doesn't. */
    licenceStatus(reference: string): Promise<NationalLicenceStatus | null>;
    /** Takes a batch to print. The same batch gets the same reference. */
    requestPrint(request: NationalPrintRequest): Promise<{ reference: string }>;
}
