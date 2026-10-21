// The submission DTOs now live in @itrms/schemas (task 0.5); these global names stay for the app's legacy screens.
type IFormSubmissionBase = import('@itrms/schemas').FormSubmissionInput;
type IFormSubmission = import('@itrms/schemas').FormSubmission;
type PaginatedSubmissions = import('@itrms/schemas').SubmissionPage;
