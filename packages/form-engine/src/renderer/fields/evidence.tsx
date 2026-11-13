'use client';

/**
 * Evidence field types (task 1.13a, form-platform.md §5): a `Signature` drawn on the screen and a `Photo` taken with the
 * camera are each kept as one uploaded image file (the same `{ file_id, name, size, type }` answer as an attachment, so the
 * server links, scans and resolves them like any file); a `GeoPoint` is a place from the device's GPS or typed in.
 */
import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Camera, Eraser, LocateFixed, PenLine, X } from 'lucide-react';
import { Button, Input, Spinner, useNotify } from '@itrms/ui';

import { useFileActions, useFilePreview } from '../../host/files';
import { useEngineText } from '../../host/text';
import type { EngineField } from '../../core';
import { defineFieldType, type ValueFieldProps } from '../kit';

interface StoredFileRef {
    file_id: string;
    name: string;
    size: number;
    type: string;
}

const filesOf = (value: unknown): StoredFileRef[] =>
    (Array.isArray(value) ? value : []).filter(
        (f): f is StoredFileRef => !!f && typeof f === 'object' && 'file_id' in f
    );

const blobOf = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
    new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The image could not be made'))), type, quality)
    );

/** Uploads one image and gives the answer that keeps it. */
function useKeepImage() {
    const { uploadFile } = useFileActions();
    return async (blob: Blob, name: string): Promise<StoredFileRef> => {
        const r = await uploadFile({ file: new File([blob], name, { type: blob.type }) });
        return { file_id: r.file_id, name: r.filename, size: r.size, type: r.content_type };
    };
}

/** The kept image, shown from its stored file. */
function KeptImage({ file, alt }: { file: StoredFileRef; alt: string }) {
    const preview = useFilePreview(file.file_id);
    if (preview.isPending) return <Spinner />;
    if (!preview.data) return <span className="text-sm text-muted-foreground">{file.name}</span>;
    return (
        <img
            src={`data:${preview.data.contentType};base64,${preview.data.base64}`}
            alt={alt}
            className="max-h-48 rounded-md border bg-white object-contain"
        />
    );
}

// ---- signature ---------------------------------------------------------------------------------------------------------
const PAD_WIDTH = 480;
const PAD_HEIGHT = 160;

function SignatureField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<unknown>) {
    const { t } = useEngineText();
    const notify = useNotify();
    const keep = useKeepImage();
    const canvas = useRef<HTMLCanvasElement>(null);
    const drawing = useRef(false);
    const [drawn, setDrawn] = useState(false);
    const [busy, setBusy] = useState(false);
    const [kept] = filesOf(value);
    const label = field.label || field.id;

    const at = (e: ReactPointerEvent<HTMLCanvasElement>) => {
        const box = e.currentTarget.getBoundingClientRect();
        return {
            x: ((e.clientX - box.left) / box.width) * PAD_WIDTH,
            y: ((e.clientY - box.top) / box.height) * PAD_HEIGHT
        };
    };
    const clear = () => {
        canvas.current?.getContext('2d')?.clearRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
        setDrawn(false);
    };
    const save = async () => {
        if (!canvas.current) return;
        setBusy(true);
        try {
            onChange([await keep(await blobOf(canvas.current, 'image/png'), `${field.id}-signature.png`)]);
            clear();
        } catch {
            notify.error(t('form-engine.renderer.files.uploadFailed'));
        } finally {
            setBusy(false);
            onBlur();
        }
    };

    if (kept)
        return (
            <div className="flex flex-col items-start gap-2" data-signature="kept">
                <KeptImage file={kept} alt={t('form-engine.renderer.signature.image', { label })} />
                {!disabled && (
                    <Button id={id} type="button" variant="outline" size="sm" onClick={() => onChange([])}>
                        <PenLine />
                        {t('form-engine.renderer.signature.again')}
                    </Button>
                )}
            </div>
        );
    if (disabled)
        return <span className="text-sm text-muted-foreground">{t('form-engine.renderer.signature.none')}</span>;
    return (
        <div className="flex flex-col items-start gap-2" data-signature="pad">
            <canvas
                id={id}
                ref={canvas}
                width={PAD_WIDTH}
                height={PAD_HEIGHT}
                role="img"
                aria-label={t('form-engine.renderer.signature.pad', { label })}
                aria-invalid={invalid || undefined}
                aria-describedby={describedBy}
                className="w-full max-w-[480px] touch-none rounded-md border bg-white"
                onPointerDown={(e) => {
                    const ctx = e.currentTarget.getContext('2d');
                    if (!ctx) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drawing.current = true;
                    const p = at(e);
                    ctx.lineWidth = 2;
                    ctx.lineCap = 'round';
                    ctx.strokeStyle = '#111';
                    ctx.beginPath();
                    ctx.moveTo(p.x, p.y);
                }}
                onPointerMove={(e) => {
                    if (!drawing.current) return;
                    const ctx = e.currentTarget.getContext('2d');
                    const p = at(e);
                    ctx?.lineTo(p.x, p.y);
                    ctx?.stroke();
                    setDrawn(true);
                }}
                onPointerCancel={() => {
                    drawing.current = false;
                }}
                onPointerUp={() => {
                    drawing.current = false;
                }}
            />
            <p className="text-xs text-muted-foreground">{t('form-engine.renderer.signature.hint')}</p>
            <div className="flex gap-2">
                <Button type="button" size="sm" disabled={!drawn || busy} onClick={() => void save()}>
                    {busy ? <Spinner /> : <PenLine />}
                    {t('form-engine.renderer.signature.keep')}
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={!drawn || busy} onClick={clear}>
                    <Eraser />
                    {t('form-engine.renderer.signature.clear')}
                </Button>
            </div>
        </div>
    );
}

// ---- photo ---------------------------------------------------------------------------------------------------------------
/** The longest side a kept photo has, in pixels (a licence photo needs far less; a scene photo stays readable). */
const MAX_DIMENSION = 1600;
/** A passport photo is 3 wide by 4 high. */
const PASSPORT = 3 / 4;

/**
 * The part of a photo that is kept: all of it, or for a face (a licence photo) the largest 3:4 frame at its centre, a little
 * above the middle where a face sits. Then made at most `max` pixels on its longest side and kept as a JPEG.
 */
export function photoFrame(
    width: number,
    height: number,
    crop: 'none' | 'face',
    max = MAX_DIMENSION
): { sx: number; sy: number; sw: number; sh: number; w: number; h: number } {
    let sx = 0;
    let sy = 0;
    let sw = width;
    let sh = height;
    if (crop === 'face') {
        if (width / height > PASSPORT) {
            sw = Math.round(height * PASSPORT);
            sx = Math.round((width - sw) / 2);
        } else {
            sh = Math.round(width / PASSPORT);
            sy = Math.max(0, Math.round((height - sh) * 0.4));
        }
    }
    const scale = Math.min(1, max / Math.max(sw, sh));
    return { sx, sy, sw, sh, w: Math.round(sw * scale), h: Math.round(sh * scale) };
}

async function preparedPhoto(file: File, field: EngineField): Promise<Blob> {
    // the photo upright as taken: the EXIF orientation applied where the browser keeps it apart (follow-up 257)
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const crop = field.props.crop === 'face' ? 'face' : 'none';
    const f = photoFrame(bitmap.width, bitmap.height, crop);
    const canvas = document.createElement('canvas');
    canvas.width = f.w;
    canvas.height = f.h;
    canvas.getContext('2d')?.drawImage(bitmap, f.sx, f.sy, f.sw, f.sh, 0, 0, f.w, f.h);
    bitmap.close();
    return blobOf(canvas, 'image/jpeg', 0.85);
}

const isHeic = (file: File) => /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

/** Whether this browser can draw the image (Safari draws HEIC; the others do not). */
async function drawable(file: File): Promise<boolean> {
    try {
        (await createImageBitmap(file)).close();
        return true;
    } catch {
        return false;
    }
}

function PhotoField({ field, id, value, onChange, onBlur, disabled, invalid, describedBy }: ValueFieldProps<unknown>) {
    const { t } = useEngineText();
    const notify = useNotify();
    const keep = useKeepImage();
    const input = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [kept] = filesOf(value);
    const label = field.label || field.id;

    const take = async (file: File | undefined) => {
        if (!file) return;
        // HEIC (an iPhone's own format) is drawn only by Safari: elsewhere the person is asked for a JPEG (follow-up 257)
        if (isHeic(file) && !(await drawable(file))) {
            notify.error(t('form-engine.renderer.photo.heic'));
            onBlur();
            return;
        }
        setBusy(true);
        try {
            onChange([await keep(await preparedPhoto(file, field), `${field.id}-photo.jpg`)]);
        } catch {
            notify.error(t('form-engine.renderer.photo.failed'));
        } finally {
            setBusy(false);
            onBlur();
        }
    };

    return (
        <div className="flex flex-col items-start gap-2" data-photo={kept ? 'kept' : 'none'}>
            <input
                ref={input}
                type="file"
                hidden
                accept="image/*"
                capture={field.props.facing === 'user' ? 'user' : 'environment'}
                disabled={disabled}
                onChange={(e) => {
                    const [chosen] = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    void take(chosen);
                }}
            />
            {kept && <KeptImage file={kept} alt={t('form-engine.renderer.photo.image', { label })} />}
            {!kept && disabled && (
                <span className="text-sm text-muted-foreground">{t('form-engine.renderer.photo.none')}</span>
            )}
            {!disabled && (
                <div className="flex gap-2">
                    <Button
                        id={id}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        aria-invalid={invalid || undefined}
                        aria-describedby={describedBy}
                        onClick={() => input.current?.click()}
                    >
                        {busy ? <Spinner /> : <Camera />}
                        {busy
                            ? t('form-engine.renderer.photo.processing')
                            : kept
                              ? t('form-engine.renderer.photo.again')
                              : t('form-engine.renderer.photo.take')}
                    </Button>
                    {kept && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={t('form-engine.renderer.photo.remove', { label })}
                            onClick={() => onChange([])}
                        >
                            <X />
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

// ---- place ---------------------------------------------------------------------------------------------------------------
interface Point {
    lat: number;
    lng: number;
    accuracy?: number;
}
const isPoint = (v: unknown): v is Point =>
    !!v && typeof v === 'object' && typeof (v as Point).lat === 'number' && typeof (v as Point).lng === 'number';

function GeoPointField({
    field,
    id,
    value,
    onChange,
    onBlur,
    disabled,
    invalid,
    describedBy
}: ValueFieldProps<unknown>) {
    const { t } = useEngineText();
    const [locating, setLocating] = useState(false);
    const [problem, setProblem] = useState<string | null>(null);
    const point = isPoint(value) ? value : null;
    const [lat, setLat] = useState(point ? String(point.lat) : '');
    const [lng, setLng] = useState(point ? String(point.lng) : '');
    // a value set from elsewhere (a draft restored, the form reset) shows in the typed boxes too (follow-up 256)
    // (the state adjusted while rendering, as React advises for a value that follows a prop: no effect, no second paint)
    const [shownFor, setShownFor] = useState<unknown>(value);
    if (shownFor !== value) {
        setShownFor(value);
        if (isPoint(value)) {
            if (!(Number(lat) === value.lat && lat.trim() !== '')) setLat(String(value.lat));
            if (!(Number(lng) === value.lng && lng.trim() !== '')) setLng(String(value.lng));
        } else if (value === undefined || value === null) {
            setLat('');
            setLng('');
        }
    }
    // a place typed in has no accuracy, so a field that asks for one takes only the device's
    const manual = field.props.allowManual !== false && typeof field.props.maxAccuracy !== 'number';

    const typed = (nextLat: string, nextLng: string) => {
        setLat(nextLat);
        setLng(nextLng);
        const a = Number(nextLat);
        const b = Number(nextLng);
        const both = nextLat.trim() !== '' && nextLng.trim() !== '' && Number.isFinite(a) && Number.isFinite(b);
        // a place typed in has no accuracy (a field that asks for one takes only the device's); half a place is not one
        if (nextLat.trim() === '' && nextLng.trim() === '') onChange(undefined);
        else onChange(both ? { lat: a, lng: b } : { lat: nextLat, lng: nextLng });
    };

    const locate = () => {
        if (!('geolocation' in navigator)) {
            setProblem(t('form-engine.renderer.geo.unsupported'));
            return;
        }
        setLocating(true);
        setProblem(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setLocating(false);
                const found = {
                    lat: Number(pos.coords.latitude.toFixed(6)),
                    lng: Number(pos.coords.longitude.toFixed(6)),
                    accuracy: Math.round(pos.coords.accuracy)
                };
                setLat(String(found.lat));
                setLng(String(found.lng));
                onChange(found);
                onBlur();
            },
            (err) => {
                setLocating(false);
                setProblem(
                    err.code === err.PERMISSION_DENIED
                        ? t('form-engine.renderer.geo.denied')
                        : t('form-engine.renderer.geo.failed')
                );
            },
            { enableHighAccuracy: true, timeout: 20_000, maximumAge: 0 }
        );
    };

    return (
        <div className="flex flex-col gap-2" data-geopoint={point ? 'set' : 'none'}>
            {!disabled && (
                <div>
                    <Button
                        id={id}
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={locating}
                        aria-invalid={invalid || undefined}
                        aria-describedby={describedBy}
                        onClick={locate}
                    >
                        {locating ? <Spinner /> : <LocateFixed />}
                        {locating ? t('form-engine.renderer.geo.locating') : t('form-engine.renderer.geo.locate')}
                    </Button>
                </div>
            )}
            {(manual || disabled) && (
                <div className="flex flex-wrap gap-2">
                    <Input
                        className="w-40"
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder={t('form-engine.renderer.geo.lat')}
                        aria-label={t('form-engine.renderer.geo.latOf', { label: field.label || field.id })}
                        value={lat}
                        onChange={(e) => typed(e.target.value, lng)}
                        onBlur={onBlur}
                    />
                    <Input
                        className="w-40"
                        inputMode="decimal"
                        disabled={disabled}
                        placeholder={t('form-engine.renderer.geo.lng')}
                        aria-label={t('form-engine.renderer.geo.lngOf', { label: field.label || field.id })}
                        value={lng}
                        onChange={(e) => typed(lat, e.target.value)}
                        onBlur={onBlur}
                    />
                </div>
            )}
            {point?.accuracy !== undefined && (
                <span className="text-sm text-muted-foreground">
                    {t('form-engine.renderer.geo.accuracy', { accuracy: point.accuracy })}
                </span>
            )}
            {problem && <p className="text-sm text-destructive">{problem}</p>}
        </div>
    );
}

defineFieldType({ kind: 'value', type: 'Signature', Render: SignatureField });
defineFieldType({ kind: 'value', type: 'Photo', Render: PhotoField });
defineFieldType({ kind: 'value', type: 'GeoPoint', Render: GeoPointField });
