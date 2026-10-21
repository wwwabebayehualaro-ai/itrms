'use client';

import TemplatesManager from '@/form-templates/TemplatesManager';
import { useSubmissionMutations } from '@itrms/form-engine/renderer';
import { getDeviceInfo } from '@/lib/clientInfo';

/** Templates Pool: people pick a form and fill in a request; the request is stored with the device it came from. */
export default function FormInitiatorPage() {
    // failures are toasted by the platform error handler; the form stays open for another try
    const { create } = useSubmissionMutations();
    const submit = async (payload: IFormSubmissionBase) => {
        const device = getDeviceInfo();
        return await create.mutateAsync({
            ...payload,
            files_uploaded: payload.files_uploaded ?? {},
            form_metadata: {
                ...payload.form_metadata,
                user_agent: device.userAgent || navigator.userAgent,
                device_info: device,
                submitted_at: new Date().toISOString()
            },
            status: 'submitted'
        });
    };
    return <TemplatesManager mode="start" onFormSubmit={submit} />;
}
