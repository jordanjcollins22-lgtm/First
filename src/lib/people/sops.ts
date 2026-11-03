/** Every repeatable process in the same eleven-part format. */
export interface Sop {
  stage: string;
  name: string;
  definition: string;
  purpose: string;
  owner: string;
  trigger: string;
  inputs: string;
  procedure: string[];
  standards: string;
  completion: string;
  exceptions: string;
  next: string;
}

export const DEFINITIONS: { term: string; meaning: string }[] = [
  { term: "Job Description", meaning: "A written explanation of a position, including its purpose, responsibilities, qualifications, compensation structure, expectations, and what successful performance looks like." },
  { term: "Job Application", meaning: "A standardized process for collecting candidate information, qualifications, experience, availability, transportation information, and other job-related details." },
  { term: "Screening", meaning: "Reviewing applications against predetermined minimum requirements to determine whether candidates qualify to proceed." },
  { term: "Interview", meaning: "A structured conversation and assessment used to evaluate qualifications, communication, attitude, reliability, problem-solving ability, and suitability for the position." },
  { term: "Job Offer", meaning: "Formal communication of the proposed position, compensation, work arrangements, responsibilities, and applicable employment terms." },
  { term: "Onboarding", meaning: "The process of integrating a new hire into the company by completing administrative requirements, establishing expectations, introducing company procedures, and preparing the employee for their role." },
  { term: "Training", meaning: "The structured process of teaching employees the knowledge, skills, techniques, safety procedures, and operational standards necessary to perform their assigned work." },
  { term: "Evaluation", meaning: "A documented assessment comparing employee performance against established standards to determine competency, identify deficiencies, and establish readiness for additional responsibility." },
  { term: "Deployment", meaning: "Assigning an employee to actual projects based on verified qualifications, training completion, and demonstrated ability." },
  { term: "Performance Management", meaning: "Continuously monitoring work quality, productivity, reliability, and adherence to company standards, while providing feedback and corrective training." },
  { term: "Offboarding", meaning: "The documented process of ending an employment or contractor relationship, including final administrative requirements, return of company property, and access removal." },
];

export const SOPS: Sop[] = [
  {
    stage: "application", name: "Job Application", definition: "Collecting a candidate's information in the standard form.",
    purpose: "Collect the information necessary to determine whether an applicant may qualify for a position.",
    owner: "Account Manager", trigger: "Someone opens an application from a job ad or the careers page.",
    inputs: "Legal name, contact information, position, experience, skills, availability, transportation, license, desired compensation, start date, certifications, and job-related answers.",
    procedure: ["Applicant completes the form.", "The system links it to one candidate profile.", "The applicant receives a confirmation."],
    standards: "Every required answer is present, and work authorization documents are collected only at the appropriate stage.",
    completion: "The application is saved to one profile and confirmed.", exceptions: "A repeat application stays on the same profile. A failed submission asks them to try again.", next: "Screening",
  },
  {
    stage: "screening", name: "Screening", definition: "Checking an application against standardized, job-related minimum requirements.",
    purpose: "Determine whether an applicant meets the minimum qualifications.",
    owner: "Account Manager", trigger: "An application is submitted.",
    inputs: "The application and the position's minimum requirements.",
    procedure: ["The system applies the position's requirements.", "It records Qualified, Requires Review, or Not Qualified with the reason.", "Qualified applicants send a short video.", "A person decides each Requires Review application."],
    standards: "Only job-related criteria. The decision and reason are recorded.",
    completion: "A decision and reason are recorded, and qualified applicants' videos are reviewed.", exceptions: "A wrong answer by mistake can be reopened by a reviewer.", next: "Interview, or the record closes",
  },
  {
    stage: "interview", name: "Interview", definition: "A structured conversation and scorecard assessment.",
    purpose: "Determine whether the applicant demonstrates the necessary qualifications, reliability, communication, and potential to succeed.",
    owner: "Account Manager", trigger: "A qualified applicant is invited to interview.",
    inputs: "Application, video, and the interview scorecard.",
    procedure: ["Confirm the time and place.", "Cover all eight scorecard areas.", "Document responses and assessment results.", "Record Advance, Additional Interview Required, or Decline."],
    standards: "The same scorecard for every applicant, on job-related matters.",
    completion: "The scorecard and decision are saved.", exceptions: "Additional Interview Required keeps them at this stage. A no-show is noted and they may be declined.", next: "Job Offer, or the record closes",
  },
  {
    stage: "job_offer", name: "Job Offer", definition: "Formal communication of the proposed terms.",
    purpose: "Establish the proposed working relationship and communicate its terms.",
    owner: "Account Manager", trigger: "The interview outcome is Advance.",
    inputs: "Position, compensation, classification, schedule, responsibilities, transportation and equipment requirements, start date, and applicable agreements.",
    procedure: ["Complete every offer term.", "Decide classification from the actual working relationship and applicable law.", "Send the offer.", "Record accepted or declined."],
    standards: "Terms are complete. Classification isn't set by payment method or contract label.",
    completion: "The offer is accepted or declined, with the date recorded.", exceptions: "A declined or withdrawn offer closes the record, and its history stays.", next: "Onboarding",
  },
  {
    stage: "onboarding", name: "Onboarding", definition: "Compliance, Clarity, Culture, Connection, and Check-Back.",
    purpose: "Establish how the company operates and prepare the person for their role.",
    owner: "Account Manager", trigger: "An offer is accepted.",
    inputs: "The accepted offer and the onboarding checklist for their position and classification.",
    procedure: ["Complete Compliance items by their due dates.", "Explain Clarity items.", "Communicate Culture.", "Make the Connection introductions.", "Complete Check-Back: acknowledgment, questions, and an initial review."],
    standards: "Legal items are done according to their actual requirements. Ticking a checklist never replaces legal compliance.",
    completion: "All required administrative and orientation requirements are satisfied, not merely when someone attends their first day.", exceptions: "Overdue items appear under Requires Attention until resolved.", next: "Training",
  },
  {
    stage: "training", name: "Training", definition: "Teaching the specific responsibilities of the position.",
    purpose: "Teach the knowledge, skills, safety, and standards needed for the assigned work.",
    owner: "Project Lead", trigger: "Onboarding is complete.",
    inputs: "Modules assigned for the position.",
    procedure: ["They read the written training.", "We show them.", "They show us. If something is wrong, stop them immediately, correct it, and let them continue.", "Once they can do it without us, they teach someone else."],
    standards: "Each module has the ten standard parts, and only published modules are assigned.",
    completion: "Every required module has its read, show, show-back, and teach steps recorded.", exceptions: "They stay in Training until complete. Corrections are recorded.", next: "Evaluation",
  },
  {
    stage: "evaluation", name: "Employee Evaluation", definition: "A documented assessment of observable performance.",
    purpose: "Determine competency, identify deficiencies, and establish readiness.",
    owner: "Project Lead", trigger: "Training is complete, or a performance or advancement question arises.",
    inputs: "Skill being evaluated, criteria, observed work, and notes or photographs.",
    procedure: ["Observe the work.", "Record each criterion, supporting notes or photographs, and required corrective actions.", "Record Pass, Needs Improvement, or Fail."],
    standards: "Based on observable performance only.",
    completion: "Every required skill has a Pass, which verifies the competency.", exceptions: "A failed evaluation doesn't automatically result in termination. It leads to corrective training, reevaluation, or an appropriate personnel decision.", next: "Deployment",
  },
  {
    stage: "deployment", name: "Deployment", definition: "Assigning a person to projects based on verified ability.",
    purpose: "Put people only on work they've shown they can do.",
    owner: "Project Lead", trigger: "Required evaluations are passed.",
    inputs: "Verified competencies and the assignment.",
    procedure: ["Review verified competencies.", "Confirm the first assignment and responsible lead.", "Move them to performance management."],
    standards: "Unsupervised work only after demonstrated competency.",
    completion: "The first assignment and lead are confirmed.", exceptions: "Missing a needed competency means supervised work and training first.", next: "Performance Management",
  },
  {
    stage: "performance_management", name: "Performance Management", definition: "Tracking work after deployment.",
    purpose: "Maintain standards with feedback and corrective training.",
    owner: "Project Lead", trigger: "Deployment.",
    inputs: "Quality, completion, productivity, attendance, safety, communication, customer feedback, callbacks, and procedures.",
    procedure: ["Record measurements and feedback.", "Assign retraining when needed.", "Evaluate again when something changes."],
    standards: "Clear statuses and measurable results, with no complicated scoring.",
    completion: "This is ongoing until Advancement or Offboarding.", exceptions: "Serious issues lead to reevaluation or a personnel decision.", next: "Advancement or Offboarding",
  },
  {
    stage: "advancement", name: "Advancement", definition: "Moving to a new role based on documented qualifications.",
    purpose: "Recognize qualifications, performance, competency, and business need.",
    owner: "Account Manager", trigger: "The person shows readiness and a role is available.",
    inputs: "Performance record, verified competencies, and the new role's requirements.",
    procedure: ["Review the documented record.", "Assign any new training.", "Record the role change."],
    standards: "Roles are different responsibilities, not always a single line: Affiliate, Evaluator, Project Technician, Project Lead, Account Manager.",
    completion: "The new role is recorded and required training is complete.", exceptions: "When requirements aren't met, record what's needed.", next: "Performance Management",
  },
  {
    stage: "offboarding", name: "Offboarding", definition: "Ending an employment or contractor relationship.",
    purpose: "Document final requirements, return of property, and access removal.",
    owner: "Account Manager", trigger: "The relationship is ending.",
    inputs: "Offboarding checklist, final pay details, and property list.",
    procedure: ["Start offboarding.", "Complete final administrative requirements.", "Collect company property.", "Remove access.", "Record final notes."],
    standards: "Every required item is complete, and legal requirements are followed outside the checklist as well.",
    completion: "All required items are complete and the record is marked Offboarded.", exceptions: "Unreturned property stays open and is escalated to the owner.", next: "None",
  },
];
