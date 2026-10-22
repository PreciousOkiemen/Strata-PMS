// The 8 Strata PMS emails. Table layout and inline styles only, so they look right in Gmail and Outlook.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const base = () => (process.env.APP_URL || 'https://strata-pms.vercel.app').replace(/\/$/, '');
const FONT = "'Helvetica Neue',Helvetica,Arial,sans-serif";

const h1 = (t) => `<h1 style="margin:0 0 18px;font-size:24px;line-height:1.25;color:#0C6291;font-family:${FONT}">${esc(t)}</h1>`;
const p = (t, small) => `<p style="margin:0 0 18px;font-size:${small ? 13 : 15}px;line-height:1.5;color:${small ? '#5B6472' : '#101619'}">${t}</p>`;
const button = (label, url) => `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr><td style="border-radius:999px;background:#0C6291"><a href="${esc(url)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#FFFFFF;text-decoration:none;font-family:${FONT}">${esc(label)}</a></td></tr></table>`;
const rows = (list) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#F3F8F8;border:1px solid #D6E5EF;border-radius:10px"><tr><td style="padding:6px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${list.map(([k, v], i) => `<tr><td style="padding:10px 0;${i ? 'border-top:1px solid #E3EEF3;' : ''}font-size:14px;color:#5B6472">${esc(k)}</td><td align="right" style="padding:10px 0 10px 16px;${i ? 'border-top:1px solid #E3EEF3;' : ''}font-size:14px;font-weight:700;color:#101619">${esc(v)}</td></tr>`).join('')}</table></td></tr></table>`;
const quote = (who, text) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr><td style="background:#F3F8F8;border-radius:10px;padding:14px 16px;font-size:15px;line-height:1.5;color:#101619"><div style="font-size:13px;color:#5B6472;margin-bottom:4px">${esc(who)}</div>${esc(text)}</td></tr></table>`;
const strip = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&amp;/g, '&');

function layout({ to, preview, body }) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#EAF2F7;font-family:${FONT}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#EAF2F7">${esc(preview || '')}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EAF2F7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #D6E5EF;border-radius:12px;overflow:hidden">
<tr><td style="background:#0C6291;padding:18px 32px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td width="36" style="width:36px"><img src="${base()}/email-logo.png" width="26" height="26" alt="" style="display:block;border:0"></td>
<td style="font-size:22px;font-weight:700;color:#FFFFFF;font-family:${FONT}">Strata</td>
<td align="right" style="font-size:13px;color:#D6E5EF">Performance Management</td></tr></table></td></tr>
<tr><td style="padding:32px;color:#101619;font-family:${FONT}">${body}</td></tr>
<tr><td align="center" style="background:#F3F8F8;border-top:1px solid #E3EEF3;padding:20px 32px;font-size:12px;line-height:1.6;color:#5B6472">This email was sent to ${esc(to)}<br><span style="color:#6B7280">Strata · Lagos, Nigeria</span></td></tr>
</table></td></tr></table></body></html>`;
}
const make = (subject, to, preview, bodyParts) => {
  const body = bodyParts.join('');
  return { subject, html: layout({ to, preview, body }), text: strip(body.replace(/<\/(p|h1|tr|div)>/g, '\n').replace(/<a [^>]*href="([^"]+)"[^>]*>([^<]*)<\/a>/g, '$2: $1')).replace(/\n{3,}/g, '\n\n').trim() };
};
const first = (n) => esc(String(n || '').split(' ')[0] || 'there');
const link = () => `${base()}/`;

// 1. Invite: the person has been added and should create their account
function invite({ name, email }) {
  return make('You have been invited to Strata PMS', email, 'Create your account to set up your scorecard.', [
    h1('Create your Strata PMS account'), p(`Hi ${first(name)},`),
    p('You now have access to Strata PMS, where you will set up your scorecard and follow your reviews. Create your account to get started. It takes about a minute.'),
    button('Create my account', link()),
    p(`Use this work email when you sign up: <strong>${esc(email)}</strong>`),
    p(`If the button does not work, copy this link into your browser: <a href="${link()}" style="color:#0C6291">${esc(base().replace(/^https?:\/\//, ''))}</a>`, true),
    p('If you were not expecting this email, you can ignore it.', true)]);
}

// 2. A scorecard is waiting for this person (line manager, overall manager, calibration, Chief of Staff, CEO)
function awaiting({ name, email, employee, practice, quarter, fy, fromName, step }) {
  const lead = fromName && fromName !== employee
    ? `${esc(fromName)} has sent ${esc(employee)}’s ${esc(quarter)} FY${esc(fy)} scorecard to you for ${esc(step)}.`
    : `${esc(employee)} has submitted their ${esc(quarter)} FY${esc(fy)} scorecard. It is waiting for your ${esc(step)}.`;
  return make(`Action needed: ${employee}’s ${quarter} scorecard is waiting for you`, email, `${employee}’s scorecard needs your ${step}.`, [
    h1('A scorecard is waiting for your review'), p(`Hi ${first(name)},`), p(lead),
    rows([['Employee', employee], ['Practice', practice || '–']]), button('Review scorecard', link()),
    p('You can approve it, or send it back to the previous step with a reason.', true)]);
}

// 3. Returned: to the employee (employee omitted) or to an earlier approver
function returned({ name, email, byName, byRole, reason, quarter, fy, employee }) {
  const own = !employee;
  return make(own ? `Your ${quarter} scorecard was returned for changes` : `${employee}’s ${quarter} scorecard was returned to you`, email, `${byName}: ${reason}`, [
    h1(own ? 'Your scorecard was returned' : 'A scorecard was returned to you'), p(`Hi ${first(name)},`),
    p(own ? `${esc(byName)} returned your ${esc(quarter)} FY${esc(fy)} scorecard so you can update it. This is what they said:`
          : `${esc(byName)} returned ${esc(employee)}’s ${esc(quarter)} FY${esc(fy)} scorecard to you for another look. This is what they said:`),
    quote(`${byName}${byRole ? ' · ' + byRole : ''}`, reason), button(own ? 'Update my scorecard' : 'Open scorecard', link()),
    p(own ? 'Your scores are saved. Make the changes and submit again when you are ready.' : 'Make your changes and send it on again when you are ready.', true)]);
}

// 4. Final result (CEO approved)
function final({ name, email, quarter, fy, total, rating, approvers }) {
  const t = total == null ? '–' : Number(total).toFixed(2);
  return make(`Your ${quarter} FY${fy} result is final`, email, `Final result: ${t} / 5, ${rating || ''}`, [
    h1('Your result is final'), p(`Hi ${first(name)},`), p(`Your ${esc(quarter)} FY${esc(fy)} scorecard has been approved by the CEO. Here is your final result.`),
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;background:#F3F8F8;border:1px solid #D6E5EF;border-radius:10px"><tr><td style="padding:18px 20px"><span style="font-size:44px;font-weight:700;color:#0C6291;line-height:1">${esc(t)}</span> <span style="color:#5B6472">/ 5</span>${rating ? ` &nbsp; <span style="display:inline-block;background:#D6E5EF;color:#0C6291;font-weight:700;padding:4px 14px;border-radius:99px;font-size:14px">${esc(rating)}</span>` : ''}</td></tr></table>`,
    ...(approvers && approvers.length ? [rows(approvers.map((a) => [a.role, a.name]))] : []), button('View my scorecard', link())]);
}

// 5. A new comment (employee omitted when the recipient is the employee)
function comment({ name, email, authorName, authorRole, when, body, quarter, fy, employee }) {
  const own = !employee;
  return make(`${authorName} commented on ${own ? 'your' : employee + '’s'} ${quarter} scorecard`, email, body, [
    h1('You have a new comment'), p(`Hi ${first(name)},`),
    p(`${esc(authorName)} left a comment on ${own ? 'your' : esc(employee) + '’s'} ${esc(quarter)} FY${esc(fy)} scorecard.`),
    quote(`${authorName}${authorRole ? ' · ' + authorRole : ''}${when ? ' · ' + when : ''}`, body), button('Reply to comment', link())]);
}

// 6. Reminder to submit a draft. checks: [{label, done}]
function reminder({ name, email, quarter, fy, dueDate, daysLeft, checks }) {
  return make(`Reminder: submit your ${quarter} scorecard by ${dueDate}`, email, `Your ${quarter} scorecard is still in draft.`, [
    h1(daysLeft != null ? `Your scorecard is due in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'Your scorecard is due soon'), p(`Hi ${first(name)},`),
    p(`Your ${esc(quarter)} FY${esc(fy)} scorecard is still in draft. It needs to be submitted by ${esc(dueDate)}. Here is what is left:`),
    rows((checks || []).map((c) => [c.label, c.done ? 'Done' : 'Missing'])), button('Continue my scorecard', link()),
    p('Submitting early gives your line manager more time to review.', true)]);
}

// 7. Goals updated. goals: [{label, text}]
function goals({ name, email, byName, fy, goals: list }) {
  return make(`FY${fy} company goals have been updated`, email, 'Check that your KPIs still line up.', [
    h1('Company goals were updated'), p(`Hi ${first(name)},`), p(`${esc(byName)} updated the FY${esc(fy)} goals. Check that your KPIs still line up with them.`),
    ...(list && list.length ? [rows(list.map((g) => [g.label, g.text]))] : []), button('See goal alignment', link()),
    p('If your KPIs need to change, talk to your line manager before you submit.', true)]);
}

// 8. Password reset link
function reset({ name, email, url, minutes = 60 }) {
  return make('Reset your Strata PMS password', email, `This link works for ${minutes} minutes.`, [
    h1('Reset your password'), p(`Hi ${first(name)},`),
    p(`We received a request to reset your Strata PMS password. Use the button below to choose a new one. The link works for ${minutes} minutes.`),
    button('Choose a new password', url), p('If you did not ask for this, you can ignore this email. Your password stays the same.', true)]);
}

module.exports = { invite, awaiting, returned, final, comment, reminder, goals, reset };