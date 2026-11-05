/**
 * The national driver platform's stand-in until an interface exists (task 0.24a). It accepts by default; a test or a demo can have it
 * refuse, stall, or issue its own numbers. It keeps what it was asked in memory, as a real platform keeps it in its own records.
 */
import type {
    NationalDriverPlatform,
    NationalLicenceAnswer,
    NationalLicenceRequest,
    NationalLicenceStatus,
    NationalPrintRequest
} from '../contracts/national-driver-platform';

export interface FakePlatformOptions {
    /** what it says to a request; accepted unless told otherwise */
    decide?: (
        request: NationalLicenceRequest
    ) => { status: 'accepted' | 'pending' } | { status: 'rejected'; reason: string };
    /** it gives the numbers itself, as the real platform is expected to one day */
    issuesNumbers?: boolean;
}

export class FakeNationalDriverPlatform implements NationalDriverPlatform {
    private readonly answers = new Map<string, NationalLicenceAnswer>();
    private readonly statuses = new Map<string, NationalLicenceStatus['status']>();
    private readonly prints = new Map<string, string>();
    private sequence = 0;
    /** what it was asked, for tests */
    readonly requests: NationalLicenceRequest[] = [];
    readonly printRequests: NationalPrintRequest[] = [];

    constructor(private readonly options: FakePlatformOptions = {}) {}

    requestLicence(request: NationalLicenceRequest): Promise<NationalLicenceAnswer> {
        this.requests.push(request);
        const known = this.answers.get(request.requestId);
        if (known?.status === 'accepted' || known?.status === 'rejected') return Promise.resolve(known);
        const reference = known?.reference ?? `FAKE-DL-${String((this.sequence += 1)).padStart(6, '0')}`;
        const decided = this.options.decide?.(request) ?? { status: 'accepted' as const };
        const answer: NationalLicenceAnswer =
            decided.status === 'accepted'
                ? {
                      status: 'accepted',
                      reference,
                      licenceNumber: this.options.issuesNumbers ? `ETH-${reference}` : null
                  }
                : decided.status === 'rejected'
                  ? { status: 'rejected', reference, reason: decided.reason }
                  : { status: 'pending', reference };
        this.answers.set(request.requestId, answer);
        this.statuses.set(
            reference,
            answer.status === 'accepted' ? 'active' : answer.status === 'rejected' ? 'rejected' : 'pending'
        );
        return Promise.resolve(answer);
    }

    licenceStatus(reference: string): Promise<NationalLicenceStatus | null> {
        const status = this.statuses.get(reference);
        return Promise.resolve(status ? { reference, status } : null);
    }

    requestPrint(request: NationalPrintRequest): Promise<{ reference: string }> {
        this.printRequests.push(request);
        const reference =
            this.prints.get(request.batchId) ?? `FAKE-PRINT-${String(this.prints.size + 1).padStart(6, '0')}`;
        this.prints.set(request.batchId, reference);
        return Promise.resolve({ reference });
    }
}
