const recruitment = 'Recruitment Management';
const training = 'Training and Development';
const performance = 'Performance Management';
export const managementMenus = [recruitment, training, performance, 'Others'];

const text = (key, label, required = true) => ({ key, label, type: 'text', required });
const date = (key, label) => ({ key, label, type: 'date', required: true });
const ref = (key, label, reference, required = true) => ({ key, label, type: 'reference', reference, required });
const choice = (key, label, options) => ({ key, label, type: 'select', options, required: true });
const employee = ref('employeeId', 'Employee', 'employees');
const applicant = ref('applicantId', 'Applicant', 'applicants');
const course = ref('sessionId', 'Scheduled training', 'trainingSessions', false);
const reviewer = text('reviewer', 'Evaluator');
const rating = choice('rating', 'Rating', ['1','2','3','4','5']);
const attachment = { key: 'attachment', label: 'Document (PDF, PNG or JPEG, up to 500 KB)', type: 'attachment' };
const period = [date('fromDate', 'Period start'), date('toDate', 'Period end')];
function record(menu, title, nameLabel, fields) {
  return { menu, title, fields: [
    text('code', 'Record reference'), text('name', nameLabel), ref('siteId', 'Site / location', 'sites'),
    ...fields, text('remarks', 'Notes', false),
  ] };
}

function other(category, title, nameLabel, fields) {
  return {...record('Others', title, nameLabel, fields), category};
}

export const managementModules = {
  manpowerRequisitions: record(recruitment, 'Manpower Requisition', 'Position requested', [
    text('department', 'Department'), {key:'headcount', label:'Headcount', type:'number', required:true, min:1},
    date('neededBy', 'Required by'), text('reason', 'Hiring justification')]),
  jobPostings: record(recruitment, 'Job Posting', 'Job title', [
    ref('requisitionId', 'Manpower requisition', 'manpowerRequisitions', false), text('channel', 'Posting channel'),
    date('fromDate', 'Posting date'), date('toDate', 'Application deadline'), text('description', 'Role requirements')]),
  applicants: record(recruitment, 'Applicant Database', 'Applicant name', [
    text('email', 'Email'), text('phone', 'Phone', false), ref('jobId', 'Job posting', 'jobPostings', false),
    date('appliedOn', 'Application date')]),
  resumes: record(recruitment, 'Resume Management', 'Résumé title', [applicant, date('receivedOn', 'Received on'), {...attachment, required:true}]),
  interviewSchedules: record(recruitment, 'Interview Scheduling', 'Interview round', [
    applicant, date('date', 'Interview date'), {key:'time', label:'Interview time', type:'time', required:true},
    text('panel', 'Interview panel'), text('location', 'Venue or meeting link')]),
  interviewEvaluations: record(recruitment, 'Interview Evaluation', 'Evaluation title', [
    ref('interviewId', 'Scheduled interview', 'interviewSchedules'), reviewer, rating, text('feedback','Feedback'),
    choice('outcome', 'Recommendation', ['Proceed','Hold','Decline'])]),
  offerLetters: record(recruitment, 'Offer Letter', 'Offered position', [
    applicant, date('issuedOn','Offer date'), date('joiningDate','Proposed joining date'),
    text('terms', 'Employment terms'), choice('response','Offer status',['Issued','Accepted','Declined','Withdrawn']), attachment]),
  joiningFormalities: record(recruitment, 'Joining Formalities', 'Joining checklist', [
    ref('offerId','Offer letter','offerLetters'), date('joiningDate','Joining date'), text('documents','Documents checked'),
    choice('completion','Checklist status',['In progress','Complete'])]),
  trainingSessions: record(training, 'Training Calendar', 'Course title', [
    text('trainer','Trainer'), date('fromDate','Start date'), date('toDate','End date'), text('venue','Venue or meeting link')]),
  trainingRequests: record(training, 'Training Request', 'Requested course', [
    employee, text('reason','Training need'), date('neededBy','Requested by date'), course]),
  trainingRecords: record(training, 'Employee Training Record', 'Course completed', [
    employee, course, date('completedOn','Completion date'), text('result','Outcome'), attachment]),
  safetyTraining: record(training, 'Safety Training', 'Safety topic', [
    employee, text('trainer','Instructor'), date('date','Training date'), text('result','Completion outcome'), attachment]),
  skillAssessments: record(training, 'Skill Assessment', 'Skill assessed', [
    employee, reviewer, date('date','Assessment date'), choice('level','Proficiency',['Beginner','Intermediate','Advanced','Expert'])]),
  trainingEvaluations: record(training, 'Performance Evaluation', 'Training evaluation title', [
    employee, course, reviewer, date('date','Evaluation date'), rating, text('impact','Observed impact')]),
  performanceIndicators: record(performance, 'KPI/KRA Management', 'Indicator name', [
    text('area','Key result area'), text('role','Applicable role'), text('measure','Measurement method'), text('target','Target')]),
  employeeGoals: record(performance, 'Goal Setting', 'Goal', [
    employee, ref('indicatorId','KPI / KRA','performanceIndicators',false), text('target','Success measure'), date('dueDate','Due date')]),
  employeeAppraisals: record(performance, 'Employee Appraisal', 'Appraisal title', [
    employee, ...period, reviewer, rating, text('achievements','Achievements')]),
  hodEvaluations: record(performance, 'HOD Evaluation', 'Evaluation title', [
    employee, text('hod','Department head'), ...period, rating, text('feedback','Department head feedback')]),
  annualReviews: record(performance, 'Annual Performance Review', 'Review title', [
    employee, ...period, reviewer, rating, text('summary','Annual review summary')]),
  promotionRecommendations: record(performance, 'Promotion Recommendations', 'Proposed designation', [
    employee, text('recommendedBy','Recommended by'), date('date','Recommendation date'), text('reason','Supporting rationale')]),
  contractorManpower: other('Contractor Management', 'Contractor Wise Manpower', 'Contractor name', [
    date('date', 'Attendance date'), {key: 'headcount', label: 'Manpower count', type: 'number', required: true, min: 0}]),
  visitorEntries: other('Visitor Management', 'Visitor Entry & Tracking', 'Visitor name', [
    date('date', 'Visit date'), text('host', 'Person visited'), text('purpose', 'Purpose of visit')]),
  welfareCanteen: other('Employee Welfare', 'Canteen', 'Canteen service', [date('date', 'Service date')]),
  welfareAccommodation: other('Employee Welfare', 'Accommodation', 'Accommodation details', [employee]),
  welfareFacilities: other('Employee Welfare', 'Other Facilities', 'Facility name', []),
  medicalFitness: other('Medical Management', 'Medical Examination & Fitness', 'Examination', [employee, date('date', 'Examination date')]),
  disciplinaryNotices: other('Disciplinary Management', 'Warning Letters & Show-Cause Notices', 'Subject', [employee, date('date', 'Issue date')]),
  employeeComplaints: other('Grievance Management', 'Employee Complaints', 'Complaint subject', [employee, date('date', 'Received on')]),
  laptopAllocations: other('Asset Allocations', 'Laptop', 'Laptop identifier', [employee, date('date', 'Allocation date')]),
  mobileAllocations: other('Asset Allocations', 'Mobile', 'Mobile identifier', [employee, date('date', 'Allocation date')]),
  uniformAllocations: other('Asset Allocations', 'Uniform', 'Uniform description', [employee, date('date', 'Allocation date')]),
  ppeAllocations: other('Asset Allocations', 'PPE', 'Protective equipment', [employee, date('date', 'Allocation date')]),
  employeeResignations: other('Exit Management', 'Resignation', 'Resignation subject', [employee, date('date', 'Submitted on')]),
  employeeClearances: other('Exit Management', 'Clearance', 'Clearance item', [employee, date('date', 'Clearance date')]),
};
