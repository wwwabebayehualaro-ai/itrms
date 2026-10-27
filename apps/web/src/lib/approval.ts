'use client';

/**
 * Maker-checker approvals of forms' publications (SEC-AC-6, `api/v1/form-publications`): one person asks to publish a
 * version, another decides. These hooks serve the inbox and the decisions, in the shape the inbox shows (the wire's
 * `withdrawn` is the inbox's `cancelled`, its decision note the inbox's `comment`).
 */
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import client from './api/client';
import { useAuthStore } from './auth/authStore';
import { createKeys } from './query/keys';

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';
export type ApprovalScope = 'to_decide' | 'mine' | 'all';

/** A publication as the forms API sends it (@itrms/forms contracts: publicationSchema). */
interface Publication {
    id: string;
    version: number;
    formId: string;
    formName: Record<string, string>;
    formVersion: { id: string; number: number };
    status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
    note: string | null;
    requestedBy: string | null;
    requestedByName: string | null;
    requestedAt: string;
    decidedBy: string | null;
    decidedByName: string | null;
    canDecide: boolean;
    canWithdraw: boolean;
    decidedAt: string | null;
    decisionNote: string | null;
}

export interface Approval {
    id: string;
    title: string;
    policy_title: string;
    form_id: string;
    status: ApprovalStatus;
    note: string | null;
    requested_by: string | null;
    requested_by_name: string | null;
    created_at: string;
    decided_by_name: string | null;
    decided_at: string | null;
    comment: string | null;
    can_decide: boolean;
    can_cancel: boolean;
    row_version: number;
}

export interface ApprovalListParams {
    scope: ApprovalScope;
    status?: ApprovalStatus;
    /** one form's requests */
    form_id?: string;
    page?: number;
    page_size?: number;
}

export interface ApprovalPage {
    items: Approval[];
    total: number;
}

const BASE = 'v1/form-publications';
const STATUS_ON_WIRE: Record<ApprovalStatus, Publication['status']> = {
    pending: 'pending',
    approved: 'approved',
    rejected: 'rejected',
    cancelled: 'withdrawn'
};

const nameIn = (text: Record<string, string>) => {
    const lang = typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en';
    return text[lang] ?? text.en ?? Object.values(text)[0] ?? '';
};

export function approvalOf(p: Publication): Approval {
    return {
        id: p.id,
        title: `Publish “${nameIn(p.formName)}” (version ${p.formVersion.number})`,
        policy_title: 'Publishing a form',
        form_id: p.formId,
        status: p.status === 'withdrawn' ? 'cancelled' : p.status,
        note: p.note,
        requested_by: p.requestedBy,
        requested_by_name: p.requestedByName,
        created_at: p.requestedAt,
        decided_by_name: p.decidedByName,
        decided_at: p.decidedAt,
        comment: p.decisionNote,
        can_decide: p.canDecide,
        can_cancel: p.canWithdraw,
        row_version: p.version
    };
}

export const approvalKeys = createKeys('approvals');

/**
 * One status at a time (the API's newest 100 in the active unit's view), narrowed to the scope and paged here: "to decide"
 * is what the caller may decide, "mine" what they asked for.
 */
export function useApprovals(params: ApprovalListParams) {
    const me = useAuthStore((s) => s.user?.id);
    return useQuery({
        queryKey: approvalKeys.list({ ...params, me }),
        queryFn: async ({ signal }): Promise<ApprovalPage> => {
            const status = params.scope === 'to_decide' ? 'pending' : (params.status ?? 'pending');
            const all = (
                await client.get<{ items: Publication[] }>(BASE, {
                    params: { status: STATUS_ON_WIRE[status], formId: params.form_id },
                    signal
                })
            ).data.items.map(approvalOf);
            const kept = all.filter((a) =>
                params.scope === 'to_decide' ? a.can_decide : params.scope === 'mine' ? a.requested_by === me : true
            );
            const size = params.page_size ?? 20;
            const start = ((params.page ?? 1) - 1) * size;
            return { items: kept.slice(start, start + size), total: kept.length };
        },
        placeholderData: keepPreviousData
    });
}

/** The open request of one form (a version waiting to be published), if any. */
export function usePendingApproval(formId?: string) {
    const q = useApprovals({ scope: 'all', status: 'pending', form_id: formId, page_size: 1 });
    return { ...q, data: formId ? q.data?.items[0] : undefined };
}

/**
 * What approving this request would do: its version against the published one (problems, tests, diff, affected views).
 * The caller names the shape (the form engine's PublishCheck): this layer does not import the engine.
 */
export function usePublicationReview<T>(id: string | undefined) {
    return useQuery({
        queryKey: [...approvalKeys.detail(id ?? ''), 'review'] as const,
        queryFn: async ({ signal }) => (await client.get<T>(`${BASE}/${id}/review`, { signal })).data,
        enabled: !!id,
        retry: false
    });
}

const ifMatch = (version: number) => ({ headers: { 'if-match': `"${version}"` } });

/**
 * Approve / reject / withdraw. An approval publishes the form (its gallery card, its data viewer), so every cached query
 * is marked stale afterwards; only what is on screen refetches.
 */
export function useApprovalActions() {
    const qc = useQueryClient();
    const settle = () => qc.invalidateQueries();
    const decide = async (path: string, row_version: number, body: object) =>
        approvalOf((await client.post<Publication>(`${BASE}/${path}`, body, ifMatch(row_version))).data);
    const approve = useMutation({
        mutationFn: ({ id, comment, row_version }: { id: string; comment?: string; row_version: number }) =>
            decide(`${id}/approval`, row_version, comment?.trim() ? { note: comment.trim() } : {}),
        onSuccess: settle,
        meta: { errorMessage: 'Could not approve the request' }
    });
    // the reason travels as the API's `note`; a rejection without one comes back as a 422 on it
    const reject = useMutation({
        mutationFn: ({ id, comment, row_version }: { id: string; comment: string; row_version: number }) =>
            decide(`${id}/rejection`, row_version, { note: comment.trim() }),
        onSuccess: settle,
        meta: { errorMessage: 'Could not reject the request' }
    });
    const cancel = useMutation({
        mutationFn: ({ id, row_version }: { id: string; row_version: number }) =>
            decide(`${id}/withdrawal`, row_version, {}),
        onSuccess: settle,
        meta: { errorMessage: 'Could not withdraw the request' }
    });
    return { approve, reject, cancel };
}
