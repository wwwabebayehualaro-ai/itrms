'use client';

/**
 * The form's data sources (APIs it reads options, table rows or prefilled values from, or sends to), its variables and what
 * happens on submit — `form_config.runtime`. Edits go into the builder's document, so they are undoable like any other change.
 * Requests always go through the application's authenticated client; nothing here holds a secret.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, Play, Plus, Trash2 } from 'lucide-react';
import {
    Alert,
    AlertDescription,
    Badge,
    Button,
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
    Combobox,
    Field,
    FieldDescription,
    FieldError,
    FieldLabel,
    IconButton,
    Input,
    JsonEditor,
    KeyValueEditor,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Spinner,
    Switch,
    TagsInput,
    cn
} from '@itrms/ui';
import { executeDataSource, getDependencies } from '../renderer/runtime/dataSourceClient';
import { useFormsClient } from '../host/FormsHost';
import { useEngineText } from '../host/text';
import { toOptions } from '../core/runtime/mapping';
import type { DataSourceDefinition, HttpMethod, RuntimeContext, TemplateRuntimeConfig } from '@itrms/schemas';
import { holdsValue, toEngineField, type StoredField } from '../core';
import { useServerActions } from '../api/serverActions';
import { ConditionsEditor, NumberInput, type ConditionSubject } from './controls';
import { useDesigner, useDesignerActions } from './store';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]*$/;

const newSource = (existing: DataSourceDefinition[]): DataSourceDefinition => {
    let n = existing.length + 1;
    while (existing.some((d) => d.id === `source${n}`)) n++;
    return {
        id: `source${n}`,
        request: { method: 'GET', url: '/' },
        auth: 'app',
        timeoutMs: 15000,
        cache: { staleTimeMs: 30000 },
        responseMapping: {}
    };
};

function Row({
    id,
    label,
    help,
    error,
    children
}: {
    id?: string;
    label: string;
    help?: ReactNode;
    error?: string | null;
    children: ReactNode;
}) {
    return (
        <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            {children}
            {error ? <FieldError>{error}</FieldError> : help && <FieldDescription>{help}</FieldDescription>}
        </Field>
    );
}

function Toggle({
    id,
    label,
    checked,
    onChange
}: {
    id: string;
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
}) {
    return (
        <label htmlFor={id} className="flex items-center gap-2 text-sm">
            <Switch id={id} checked={checked} onCheckedChange={onChange} />
            {label}
        </label>
    );
}

function Part({ title, open: initial = false, children }: { title: string; open?: boolean; children: ReactNode }) {
    const [open, setOpen] = useState(initial);
    return (
        <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
            <CollapsibleTrigger className="flex w-full items-center justify-between px-3 py-2 text-sm font-medium">
                {title}
                <ChevronDown className={cn('size-4 transition-transform', !open && '-rotate-90')} />
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-4 border-t p-3">{children}</CollapsibleContent>
        </Collapsible>
    );
}

function TestPanel({ ds }: { ds: DataSourceDefinition }) {
    const client = useFormsClient();
    const { t } = useEngineText();
    const [sample, setSample] = useState<unknown>({});
    const [state, setState] = useState<{ loading: boolean; error?: string; data?: unknown; count?: number }>({
        loading: false
    });
    if (ds.request.method !== 'GET')
        return (
            <Alert>
                <AlertDescription>{t('form-engine.designer.sources.testOnlyGet')}</AlertDescription>
            </Alert>
        );
    const run = async () => {
        setState({ loading: true });
        const ctx: RuntimeContext = {
            form: (sample as Record<string, unknown>) ?? {},
            data: {},
            user: {},
            route: {},
            variables: {}
        };
        try {
            const data = await executeDataSource(client, ds, ctx);
            setState({ loading: false, data, count: toOptions(data, ds.responseMapping?.options).length });
        } catch (e) {
            setState({ loading: false, error: (e as Error).message });
        }
    };
    return (
        <div className="flex flex-col gap-3">
            <Row
                label={t('form-engine.designer.sources.testSample')}
                help={t('form-engine.designer.sources.testSampleHelp', { example: '{{form.*}}' })}
            >
                <JsonEditor
                    value={sample}
                    onChange={setSample}
                    rows={3}
                    placeholder='{ "branchId": "1" }'
                    aria-label={t('form-engine.designer.sources.testSampleLabel')}
                />
            </Row>
            <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() => void run()}
                disabled={state.loading}
            >
                {state.loading ? <Spinner /> : <Play />}
                {t('form-engine.designer.sources.testRun')}
            </Button>
            {state.error && <p className="text-sm text-destructive">{state.error}</p>}
            {state.data !== undefined && (
                <>
                    <span className="text-sm text-muted-foreground">
                        {state.count
                            ? t('form-engine.designer.sources.testFound', { count: String(state.count) })
                            : t('form-engine.designer.sources.testAnswered')}
                    </span>
                    <pre className="max-h-52 overflow-auto rounded-md bg-muted p-2 text-xs">
                        {JSON.stringify(state.data, null, 2)?.slice(0, 4000)}
                    </pre>
                </>
            )}
        </div>
    );
}

function SourceEditor({
    ds,
    onChange,
    allIds,
    subjects
}: {
    ds: DataSourceDefinition;
    onChange: (d: DataSourceDefinition) => void;
    allIds: string[];
    subjects: ConditionSubject[];
}) {
    const { t } = useEngineText();
    const set = (patch: Partial<DataSourceDefinition>) => onChange({ ...ds, ...patch });
    const setReq = (patch: Partial<DataSourceDefinition['request']>) => set({ request: { ...ds.request, ...patch } });
    const setMap = (patch: Partial<NonNullable<DataSourceDefinition['responseMapping']>>) =>
        set({ responseMapping: { ...ds.responseMapping, ...patch } });
    const setOpt = (patch: Record<string, string | undefined>) =>
        setMap({ options: { ...ds.responseMapping?.options, ...patch } });
    const idError = !ID_RE.test(ds.id)
        ? t('form-engine.designer.sources.idFormat')
        : allIds.filter((i) => i === ds.id).length > 1
          ? t('form-engine.designer.sources.idTaken')
          : null;
    const isGet = ds.request.method === 'GET';
    const waits = getDependencies(ds);
    const p = `ds-${allIds.indexOf(ds.id)}`;
    return (
        <div className="flex flex-col gap-4" data-source-editor={ds.id}>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
                <Row
                    id={`${p}-id`}
                    label={t('form-engine.designer.sources.id')}
                    help={t('form-engine.designer.sources.idHelp', { example: '{{data.<id>}}' })}
                    error={idError}
                >
                    <Input
                        id={`${p}-id`}
                        value={ds.id}
                        className="font-mono text-xs"
                        onChange={(e) => set({ id: e.target.value })}
                    />
                </Row>
                <Row id={`${p}-name`} label={t('form-engine.designer.sources.name')}>
                    <Input
                        id={`${p}-name`}
                        value={ds.name ?? ''}
                        onChange={(e) => set({ name: e.target.value || undefined })}
                    />
                </Row>
            </div>
            <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                <Row id={`${p}-method`} label={t('form-engine.designer.sources.method')}>
                    <Select value={ds.request.method} onValueChange={(v) => setReq({ method: v as HttpMethod })}>
                        <SelectTrigger id={`${p}-method`} className="w-full">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {METHODS.map((m) => (
                                <SelectItem key={m} value={m}>
                                    {m}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </Row>
                <Row
                    id={`${p}-url`}
                    label={t('form-engine.designer.sources.address')}
                    help={t('form-engine.designer.sources.addressHelp', {
                        examples: '/branches, /customers/{customerId}, /customers?branchId={{form.branchId}}'
                    })}
                >
                    <Input
                        id={`${p}-url`}
                        value={ds.request.url}
                        className="font-mono text-xs"
                        onChange={(e) => setReq({ url: e.target.value })}
                    />
                </Row>
            </div>
            {waits.length > 0 && (
                <p className="text-xs text-muted-foreground">
                    {t('form-engine.designer.sources.waitsFor', { list: waits.map((d) => `{{${d}}}`).join(', ') })}
                </p>
            )}

            <Part title={t('form-engine.designer.sources.partRequest')} open>
                <Row
                    label={t('form-engine.designer.sources.pathParams')}
                    help={t('form-engine.designer.sources.pathParamsHelp', { example: '{name}' })}
                >
                    <KeyValueEditor
                        value={ds.request.pathParams}
                        onChange={(v) => setReq({ pathParams: v })}
                        keyPlaceholder="customerId"
                        aria-label={t('form-engine.designer.sources.pathParam')}
                    />
                </Row>
                <Row
                    label={t('form-engine.designer.sources.queryParams')}
                    help={t('form-engine.designer.sources.queryParamsHelp')}
                >
                    <KeyValueEditor
                        value={ds.request.query}
                        onChange={(v) => setReq({ query: v })}
                        keyPlaceholder="branchId"
                        aria-label={t('form-engine.designer.sources.queryParam')}
                    />
                </Row>
                <Row
                    label={t('form-engine.designer.sources.headers')}
                    help={t('form-engine.designer.sources.headersHelp')}
                >
                    <KeyValueEditor
                        value={ds.request.headers}
                        onChange={(v) => setReq({ headers: v })}
                        keyPlaceholder="X-Custom"
                        aria-label={t('form-engine.designer.sources.header')}
                    />
                </Row>
                {!isGet && (
                    <>
                        <Row id={`${p}-ctype`} label={t('form-engine.designer.sources.contentType')}>
                            <Select
                                value={ds.request.contentType ?? 'application/json'}
                                onValueChange={(v) =>
                                    setReq({ contentType: v as DataSourceDefinition['request']['contentType'] })
                                }
                            >
                                <SelectTrigger id={`${p}-ctype`} className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {[
                                        'application/json',
                                        'application/x-www-form-urlencoded',
                                        'multipart/form-data'
                                    ].map((c) => (
                                        <SelectItem key={c} value={c}>
                                            {c}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Row>
                        <Row
                            label={t('form-engine.designer.sources.body')}
                            help={t('form-engine.designer.sources.bodyHelp', {
                                example: '{ "query": "{{form.search}}" }'
                            })}
                        >
                            <JsonEditor
                                key={`${ds.id}-body`}
                                value={ds.request.body}
                                onChange={(v) => setReq({ body: v })}
                                rows={6}
                                aria-label={t('form-engine.designer.sources.bodyLabel')}
                            />
                        </Row>
                    </>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                    <Row id={`${p}-auth`} label={t('form-engine.designer.sources.signIn')}>
                        <Select value={ds.auth ?? 'app'} onValueChange={(v) => set({ auth: v as 'app' | 'none' })}>
                            <SelectTrigger id={`${p}-auth`} className="w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="app">{t('form-engine.designer.sources.authApp')}</SelectItem>
                                <SelectItem value="none">{t('form-engine.designer.sources.authNone')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </Row>
                    <Row id={`${p}-timeout`} label={t('form-engine.designer.sources.timeout')}>
                        <NumberInput
                            id={`${p}-timeout`}
                            value={ds.timeoutMs ?? 15000}
                            onChange={(n) => set({ timeoutMs: n })}
                        />
                    </Row>
                    {isGet && (
                        <>
                            <Row id={`${p}-retries`} label={t('form-engine.designer.sources.attempts')}>
                                <NumberInput
                                    id={`${p}-retries`}
                                    value={ds.retry?.attempts ?? 1}
                                    onChange={(n) =>
                                        set({
                                            retry: {
                                                delayMs: 500,
                                                backoffFactor: 2,
                                                ...ds.retry,
                                                attempts: Math.min(5, Math.max(1, n ?? 1))
                                            }
                                        })
                                    }
                                />
                            </Row>
                            <Row id={`${p}-delay`} label={t('form-engine.designer.sources.delay')}>
                                <NumberInput
                                    id={`${p}-delay`}
                                    value={ds.retry?.delayMs ?? 500}
                                    onChange={(n) => set({ retry: { attempts: 1, ...ds.retry, delayMs: n ?? 500 } })}
                                />
                            </Row>
                        </>
                    )}
                </div>
            </Part>

            <Part title={t('form-engine.designer.sources.partWhen')}>
                <Row
                    label={t('form-engine.designer.sources.waitRefs')}
                    help={t('form-engine.designer.sources.waitRefsHelp')}
                >
                    <TagsInput
                        value={ds.dependsOn ?? []}
                        onChange={(v) => set({ dependsOn: v.length ? v : undefined })}
                        placeholder="form.branchId"
                        aria-label={t('form-engine.designer.sources.waitFor')}
                    />
                </Row>
                <Row label={t('form-engine.designer.sources.onlyWhen')}>
                    <ConditionsEditor
                        value={ds.enabledWhen}
                        subjects={subjects}
                        onChange={(v) => set({ enabledWhen: v })}
                        emptyText={t('form-engine.designer.sources.always')}
                    />
                </Row>
                {isGet && (
                    <>
                        <div className="grid gap-3 sm:grid-cols-2">
                            <Row id={`${p}-stale`} label={t('form-engine.designer.sources.fresh')}>
                                <NumberInput
                                    id={`${p}-stale`}
                                    value={ds.cache?.staleTimeMs ?? 30000}
                                    onChange={(n) => set({ cache: { ...ds.cache, staleTimeMs: n ?? 0 } })}
                                />
                            </Row>
                            <Row id={`${p}-poll`} label={t('form-engine.designer.sources.poll')}>
                                <NumberInput
                                    id={`${p}-poll`}
                                    value={ds.refetch?.intervalMs}
                                    onChange={(n) => set({ refetch: { ...ds.refetch, intervalMs: n || undefined } })}
                                />
                            </Row>
                        </div>
                        <Toggle
                            id={`${p}-focus`}
                            label={t('form-engine.designer.sources.onFocus')}
                            checked={ds.refetch?.onWindowFocus ?? false}
                            onChange={(v) => set({ refetch: { ...ds.refetch, onWindowFocus: v } })}
                        />
                        <Toggle
                            id={`${p}-load`}
                            label={t('form-engine.designer.sources.loadIntoForm')}
                            checked={ds.loadIntoForm ?? false}
                            onChange={(v) => set({ loadIntoForm: v })}
                        />
                    </>
                )}
            </Part>

            <Part title={t('form-engine.designer.sources.partReading')}>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Row
                        id={`${p}-path`}
                        label={t('form-engine.designer.sources.payloadPath')}
                        help={t('form-engine.designer.sources.payloadPathHelp')}
                    >
                        <Input
                            id={`${p}-path`}
                            value={ds.responseMapping?.path ?? ''}
                            className="font-mono text-xs"
                            onChange={(e) => setMap({ path: e.target.value || undefined })}
                        />
                    </Row>
                    <Row
                        id={`${p}-items`}
                        label={t('form-engine.designer.sources.itemsPath')}
                        help={t('form-engine.designer.sources.itemsPathHelp')}
                    >
                        <Input
                            id={`${p}-items`}
                            value={ds.responseMapping?.options?.itemsPath ?? ''}
                            className="font-mono text-xs"
                            onChange={(e) => setOpt({ itemsPath: e.target.value || undefined })}
                        />
                    </Row>
                    <Row id={`${p}-label`} label={t('form-engine.designer.sources.optionLabel')}>
                        <Input
                            id={`${p}-label`}
                            value={ds.responseMapping?.options?.labelPath ?? ''}
                            placeholder="name"
                            className="font-mono text-xs"
                            onChange={(e) => setOpt({ labelPath: e.target.value || undefined })}
                        />
                    </Row>
                    <Row id={`${p}-value`} label={t('form-engine.designer.sources.optionValue')}>
                        <Input
                            id={`${p}-value`}
                            value={ds.responseMapping?.options?.valuePath ?? ''}
                            placeholder="id"
                            className="font-mono text-xs"
                            onChange={(e) => setOpt({ valuePath: e.target.value || undefined })}
                        />
                    </Row>
                </div>
                <Row
                    label={t('form-engine.designer.sources.intoFields')}
                    help={t('form-engine.designer.sources.intoFieldsHelp')}
                >
                    <KeyValueEditor
                        value={ds.responseMapping?.toForm}
                        onChange={(v) => setMap({ toForm: v })}
                        keyPlaceholder={t('form-engine.designer.sources.fieldKey')}
                        valuePlaceholder="response.path"
                        aria-label={t('form-engine.designer.sources.intoField')}
                    />
                </Row>
                <Row
                    label={t('form-engine.designer.sources.transforms')}
                    help={t('form-engine.designer.sources.transformsHelp', {
                        example: '[{"op":"filter","path":"","where":{"field":"active","operator":"eq","value":true}}]'
                    })}
                >
                    <JsonEditor
                        key={`${ds.id}-tf`}
                        value={ds.responseMapping?.transforms}
                        onChange={(v) =>
                            setMap({
                                transforms: v as NonNullable<DataSourceDefinition['responseMapping']>['transforms']
                            })
                        }
                        rows={4}
                        aria-label={t('form-engine.designer.sources.transformsLabel')}
                    />
                </Row>
            </Part>

            <Part title={t('form-engine.designer.sources.partFails')}>
                <div className="grid gap-3 sm:grid-cols-2">
                    <Row id={`${p}-msgpath`} label={t('form-engine.designer.sources.errorMessagePath')}>
                        <Input
                            id={`${p}-msgpath`}
                            value={ds.errorMapping?.messagePath ?? ''}
                            placeholder="detail"
                            className="font-mono text-xs"
                            onChange={(e) =>
                                set({ errorMapping: { ...ds.errorMapping, messagePath: e.target.value || undefined } })
                            }
                        />
                    </Row>
                    <Row id={`${p}-msg`} label={t('form-engine.designer.sources.errorOtherwise')}>
                        <Input
                            id={`${p}-msg`}
                            value={ds.errorMapping?.message ?? ''}
                            onChange={(e) =>
                                set({ errorMapping: { ...ds.errorMapping, message: e.target.value || undefined } })
                            }
                        />
                    </Row>
                </div>
                <Row label={t('form-engine.designer.sources.errorByStatus')}>
                    <KeyValueEditor
                        value={ds.errorMapping?.statusMessages}
                        onChange={(v) => set({ errorMapping: { ...ds.errorMapping, statusMessages: v } })}
                        keyPlaceholder="404"
                        valuePlaceholder={t('form-engine.designer.sources.errorStatusExample')}
                        aria-label={t('form-engine.designer.sources.errorStatus')}
                    />
                </Row>
            </Part>

            <Part title={t('form-engine.designer.sources.partTry')}>
                <TestPanel ds={ds} />
            </Part>
        </div>
    );
}

/** The whole runtime block of the form being built. */
export function DataSources() {
    const runtime = useDesigner((s) => s.doc.runtime);
    const byId = useDesigner((s) => s.doc.byId);
    const language = useDesigner((s) => s.language);
    const actions = useDesignerActions();
    const { t } = useEngineText();
    const [selected, setSelected] = useState(0);
    const sources = runtime.dataSources;
    const current = sources[Math.min(selected, sources.length - 1)];
    const commit = (patch: Partial<TemplateRuntimeConfig>) => actions.setRuntime({ ...runtime, ...patch });
    // one setting of "On submit" changed; an empty submit block is dropped
    const setSubmit = (patch: Partial<NonNullable<TemplateRuntimeConfig['submit']>>) => {
        const next = Object.fromEntries(
            Object.entries({ ...runtime.submit, ...patch }).filter(([, v]) => v !== undefined && v !== '' && v !== null)
        );
        commit({ submit: Object.keys(next).length ? next : undefined });
    };
    const { data: serverActions = [] } = useServerActions();
    const serverAction = serverActions.find((a) => a.key === runtime.submit?.serverAction);
    const missingFields = serverAction
        ? serverAction.fields.filter((f) => f.required && !byId[f.id]).map((f) => f.id)
        : [];
    const mutations = sources.filter((s) => s.request.method !== 'GET');
    const subjects = useMemo<ConditionSubject[]>(
        () =>
            Object.values(byId)
                .map((f) => toEngineField(f as unknown as StoredField, language))
                .filter(holdsValue)
                .map((f) => ({
                    id: `form.${f.id}`,
                    label: f.label || f.id,
                    kind: f.options.length ? 'choice' : 'text',
                    options: f.options
                })),
        [byId, language]
    );

    return (
        <div className="grid gap-4 md:grid-cols-[15rem_minmax(0,1fr)]" data-data-sources>
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-1" role="list" aria-label={t('form-engine.designer.sources.list')}>
                    {sources.map((s, i) => (
                        <div
                            key={i}
                            role="listitem"
                            className={cn(
                                'flex items-center gap-1 rounded-md border p-1 pl-2',
                                i === selected && 'border-primary bg-primary/5'
                            )}
                        >
                            <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setSelected(i)}>
                                <span className="block truncate text-sm font-medium">{s.name || s.id}</span>
                                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                    <Badge variant="outline" className="h-4 px-1 text-xs">
                                        {s.request.method}
                                    </Badge>
                                    <span className="truncate font-mono">{s.request.url}</span>
                                </span>
                            </button>
                            <IconButton
                                label={t('form-engine.designer.sources.delete', { name: s.name || s.id })}
                                className="text-destructive hover:text-destructive"
                                onClick={() => {
                                    setSelected(0);
                                    commit({ dataSources: sources.filter((_, j) => j !== i) });
                                }}
                            >
                                <Trash2 />
                            </IconButton>
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-1 self-start"
                        onClick={() => {
                            commit({ dataSources: [...sources, newSource(sources)] });
                            setSelected(sources.length);
                        }}
                    >
                        <Plus />
                        {t('form-engine.designer.sources.add')}
                    </Button>
                </div>

                <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">{t('form-engine.designer.sources.variables')}</h3>
                    <KeyValueEditor
                        value={Object.fromEntries(
                            (runtime.variables ?? []).map((v) => [
                                v.name,
                                typeof v.value === 'string' ? v.value : JSON.stringify(v.value)
                            ])
                        )}
                        onChange={(v) =>
                            commit({ variables: Object.entries(v ?? {}).map(([name, value]) => ({ name, value })) })
                        }
                        keyPlaceholder={t('form-engine.designer.sources.variableName')}
                        valuePlaceholder="{{user.id}}"
                        aria-label={t('form-engine.designer.sources.variable')}
                    />
                    <p className="text-xs text-muted-foreground">
                        {t('form-engine.designer.sources.variablesHelp', { example: '{{variables.name}}' })}
                    </p>
                </section>

                <section className="flex flex-col gap-2">
                    <h3 className="text-sm font-semibold">{t('form-engine.designer.sources.onSubmit')}</h3>
                    <Row
                        label={t('form-engine.designer.sources.alsoSend')}
                        help={t('form-engine.designer.sources.alsoSendHelp')}
                    >
                        <Combobox
                            options={mutations.map((m) => ({ label: m.name || m.id, value: m.id }))}
                            value={runtime.submit?.dataSourceId ?? null}
                            onChange={(v) =>
                                setSubmit({
                                    dataSourceId: (v as string) || undefined,
                                    ...(v ? {} : { skipDefaultSubmission: undefined, refetch: undefined })
                                })
                            }
                            placeholder={
                                mutations.length
                                    ? t('form-engine.designer.sources.nothingElse')
                                    : t('form-engine.designer.sources.addMutationFirst')
                            }
                            clearable
                            aria-label={t('form-engine.designer.sources.alsoSend')}
                        />
                    </Row>
                    {runtime.submit?.dataSourceId && (
                        <>
                            <Toggle
                                id="submit-skip"
                                label={t('form-engine.designer.sources.skipStore')}
                                checked={runtime.submit.skipDefaultSubmission ?? false}
                                onChange={(v) => setSubmit({ skipDefaultSubmission: v || undefined })}
                            />
                            <Toggle
                                id="submit-reset"
                                label={t('form-engine.designer.sources.resetAfter')}
                                checked={runtime.submit.resetOnSuccess ?? false}
                                onChange={(v) => setSubmit({ resetOnSuccess: v || undefined })}
                            />
                            <Row label={t('form-engine.designer.sources.thenAskAgain')}>
                                <TagsInput
                                    value={runtime.submit.refetch ?? []}
                                    onChange={(v) => setSubmit({ refetch: v.length ? v : undefined })}
                                    placeholder={t('form-engine.designer.sources.sourceIdPlaceholder')}
                                    aria-label={t('form-engine.designer.sources.thenAskAgain')}
                                />
                            </Row>
                        </>
                    )}
                    <Row
                        label={t('form-engine.designer.sources.serverAction')}
                        help={
                            serverAction ? serverAction.description : t('form-engine.designer.sources.serverActionHelp')
                        }
                        error={
                            missingFields.length
                                ? t('form-engine.designer.sources.missingFields', { fields: missingFields.join(', ') })
                                : null
                        }
                    >
                        <Combobox
                            options={serverActions.map((a) => ({ label: a.title, value: a.key }))}
                            value={runtime.submit?.serverAction ?? null}
                            onChange={(v) => setSubmit({ serverAction: (v as string) || undefined })}
                            placeholder={
                                serverActions.length
                                    ? t('form-engine.designer.sources.none')
                                    : t('form-engine.designer.sources.noServerActions')
                            }
                            clearable
                            aria-label={t('form-engine.designer.sources.serverAction')}
                        />
                    </Row>
                    <Row
                        label={t('form-engine.designer.sources.afterMessage')}
                        help={t('form-engine.designer.sources.afterMessageHelp', {
                            example: '{{response.submission_data.reference}}'
                        })}
                    >
                        <Input
                            value={runtime.submit?.successMessage ?? ''}
                            onChange={(e) => setSubmit({ successMessage: e.target.value })}
                            placeholder={t('form-engine.designer.sources.afterMessagePlaceholder')}
                            aria-label={t('form-engine.designer.sources.afterMessage')}
                        />
                    </Row>
                </section>
            </div>

            <div className="min-w-0">
                {current ? (
                    <SourceEditor
                        key={selected}
                        ds={current}
                        subjects={subjects}
                        allIds={sources.map((s) => s.id)}
                        onChange={(d) =>
                            commit({
                                dataSources: sources.map((s, j) =>
                                    j === Math.min(selected, sources.length - 1) ? d : s
                                )
                            })
                        }
                    />
                ) : (
                    <Alert>
                        <AlertDescription>{t('form-engine.designer.sources.empty')}</AlertDescription>
                    </Alert>
                )}
            </div>
        </div>
    );
}
