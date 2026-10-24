// Public entry of @itrms/forms for API processes (code-structure.md §4): the NestJS module, its services for other slices
// (cases, task 0.19), and the tables.
export { FormsModule } from './forms.module';
export { FormsService } from './forms.service';
export { SubmissionsService } from './submissions.service';
export * from './forms.table';
