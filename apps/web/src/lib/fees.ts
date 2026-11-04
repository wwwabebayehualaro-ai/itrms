'use client';

/**
 * Payment orders, the cashier, receipts and reversals (task 0.22b, `@itrms/fees`): queries and changes through the BFF.
 * The types come from the slice's contracts. Amounts are santim strings (never numbers); a payment names the order's
 * whole total, which the server compares (409 `amount_mismatch`).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
    ExternalIssuer,
    ExternalRefInput,
    ExternalRefOut,
    PaymentInput,
    PaymentOrderOut,
    ReceiptOut,
    ReversalOut,
    StatementImport,
    StatementLineOut,
    StatementOut
} from '@itrms/fees/contracts';

import client, { isApiError } from './api/client';
import { useAuthStore } from './auth/authStore';
import { caseKeys } from './workflow';

export type {
    ExternalIssuer,
    ExternalRefInput,
    ExternalRefOut,
    PaymentInput,
    PaymentOrderOut,
    ReceiptOut,
    ReversalOut,
    StatementImport,
    StatementLineOut,
    StatementOut
};
export type FeeLine = PaymentOrderOut['lines'][number];
export type PaymentRow = PaymentOrderOut['payments'][number];

type Text = Readonly<Partial<Record<string, string>>>;

/** The region setting that lists the banks a deposit slip may be of. */
export const BANKS_SETTING = 'fees.payments.banks';

export interface Bank {
    code: string;
    name: Text;
}

export const feeKeys = {
    all: ['fees'] as const,
    queue: (filters: object) => ['fees', 'queue', filters] as const,
    queues: () => ['fees', 'queue'] as const,
    order: (id: string) => ['fees', 'order', id] as const,
    receipt: (id: string) => ['fees', 'receipt', id] as const,
    reversals: () => ['fees', 'reversals'] as const,
    casePayment: (caseId: string) => ['fees', 'case-payment', caseId] as const,
    externalRefs: () => ['fees', 'external-refs'] as const,
    issuers: () => ['fees', 'issuers'] as const,
    statements: () => ['fees', 'statements'] as const,
    statementLines: (id: string) => ['fees', 'statements', id, 'lines'] as const
};

export interface QueueFilters {
    /** a case number */
    q?: number;
    after?: string | null;
    /** the till's queue by default, or the orders paid elsewhere */
    collection?: 'cashier' | 'elsewhere';
}

/** The open orders of the person's office, oldest first (the cashier's queue). */
export function useCashierQueue(filters: QueueFilters) {
    return useQuery({
        queryKey: feeKeys.queue(filters),
        placeholderData: keepPreviousData,
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: PaymentOrderOut[] }>('v1/payment-orders', {
                    params: {
                        state: 'open',
                        collection: filters.collection ?? 'cashier',
                        ...(filters.q ? { q: filters.q } : {}),
                        ...(filters.after ? { after: filters.after } : {}),
                        limit: 50
                    },
                    signal
                })
            ).data
    });
}

export function usePaymentOrder(id: string) {
    return useQuery({
        queryKey: feeKeys.order(id),
        queryFn: async ({ signal }) => (await client.get<PaymentOrderOut>(`v1/payment-orders/${id}`, { signal })).data
    });
}

export function useReceipt(id: string) {
    return useQuery({
        queryKey: feeKeys.receipt(id),
        queryFn: async ({ signal }) => (await client.get<ReceiptOut>(`v1/receipts/${id}`, { signal })).data
    });
}

/** The newest order of a case; null when the case has none (404). */
export function useCasePayment(caseId: string, enabled = true) {
    return useQuery({
        queryKey: feeKeys.casePayment(caseId),
        enabled,
        retry: false,
        queryFn: async ({ signal }): Promise<PaymentOrderOut | null> => {
            try {
                return (await client.get<PaymentOrderOut>(`v1/cases/${caseId}/payment`, { signal })).data;
            } catch (error) {
                if (isApiError(error) && error.response?.status === 404) return null;
                throw error;
            }
        }
    });
}

/** The receipt reversals waiting for a decision. */
export function useReversalInbox() {
    return useQuery({
        queryKey: feeKeys.reversals(),
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: ReversalOut[] }>('v1/receipt-reversals', {
                    params: { state: 'requested' },
                    signal
                })
            ).data
    });
}

/** What a payment or a reversal changes: the order, the queue, the case's payment and page, and the reversals inbox. */
function useInvalidate() {
    const queries = useQueryClient();
    return () => {
        void queries.invalidateQueries({ queryKey: feeKeys.all });
        void queries.invalidateQueries({ queryKey: caseKeys.all });
    };
}

export function useRecordPayment(orderId: string) {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async (input: PaymentInput) =>
            (
                await client.post<{ order: PaymentOrderOut; receipt: ReceiptOut }>(
                    `v1/payment-orders/${orderId}/payments`,
                    input
                )
            ).data,
        onSuccess: invalidate
    });
}

export function useRequestReversal(receiptId: string) {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async (input: { reason: string }) =>
            (await client.post<ReversalOut>(`v1/receipts/${receiptId}/reversals`, input)).data,
        onSuccess: invalidate
    });
}

export function useDecideReversal() {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async ({ id, ...body }: { id: string; decision: 'approved' | 'rejected'; note?: string }) =>
            (await client.post<ReversalOut>(`v1/receipt-reversals/${id}/decision`, body)).data,
        onSuccess: invalidate
    });
}

// ---- paid elsewhere (task 0.22c) ----

/** Who may issue a reference here: rarely changes. */
export function useExternalIssuers() {
    return useQuery({
        queryKey: feeKeys.issuers(),
        staleTime: 5 * 60 * 1000,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: ExternalIssuer[] }>('v1/external-issuers', { signal })).data
    });
}

/** The references the person sees, waiting for a decision. */
export function useExternalRefInbox() {
    return useQuery({
        queryKey: feeKeys.externalRefs(),
        queryFn: async ({ signal }) =>
            (
                await client.get<{ items: ExternalRefOut[] }>('v1/external-payment-refs', {
                    params: { state: 'pending_verification' },
                    signal
                })
            ).data
    });
}

export function useEnterExternalRef(orderId: string) {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async (input: ExternalRefInput) =>
            (await client.post<ExternalRefOut>(`v1/payment-orders/${orderId}/external-refs`, input)).data,
        onSuccess: invalidate
    });
}

export function useDecideExternalRef() {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async ({ id, ...body }: { id: string; decision: 'verified' | 'rejected'; note?: string }) =>
            (await client.post<ExternalRefOut>(`v1/external-payment-refs/${id}/decision`, body)).data,
        onSuccess: invalidate
    });
}

export function useRevokeExternalRef() {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
            (await client.post<ExternalRefOut>(`v1/external-payment-refs/${id}/revocation`, { reason })).data,
        onSuccess: invalidate
    });
}

/** The statements the person sees: while the worker reads one, the list follows it. */
export function useStatements() {
    return useQuery<{ items: StatementOut[] }>({
        queryKey: feeKeys.statements(),
        refetchInterval: (query) =>
            query.state.data?.items.some((s) => s.state === 'received' || s.state === 'matching') ? 3000 : false,
        queryFn: async ({ signal }) =>
            (await client.get<{ items: StatementOut[] }>('v1/external-statements', { signal })).data
    });
}

export function useStatementLines(statementId: string) {
    return useQuery({
        queryKey: feeKeys.statementLines(statementId),
        queryFn: async ({ signal }) =>
            (await client.get<{ items: StatementLineOut[] }>(`v1/external-statements/${statementId}/lines`, { signal }))
                .data
    });
}

export function useImportStatement() {
    const invalidate = useInvalidate();
    return useMutation({
        mutationFn: async (input: StatementImport) =>
            (await client.post<StatementOut>('v1/external-statements', input)).data,
        onSuccess: invalidate
    });
}

/**
 * The banks a deposit slip may be of: the region's setting where the workspace brings it, else null (the screen then
 * asks for the bank's code, which the server checks against the list).
 */
export function useBanks(): Bank[] | null {
    const setting = useAuthStore((s) => s.workspace?.settings[BANKS_SETTING]);
    if (!Array.isArray(setting)) return null;
    const banks = setting.flatMap((b: unknown): Bank[] => {
        if (!b || typeof b !== 'object') return [];
        const { code, name } = b as { code?: unknown; name?: unknown };
        return typeof code === 'string' && name && typeof name === 'object' ? [{ code, name: name as Text }] : [];
    });
    return banks.length > 0 ? banks : null;
}
