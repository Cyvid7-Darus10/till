/** Every sentence Till shows people, in one place. Names and details from people pass through plainText. */
import { plainText, safeLink } from './slack/text';

export const COPY = {
  noAccess: "I don't have access to our finances yet.",
  somethingWrong: 'Something went wrong on my side. Try again in a moment.',
  teamLoginLabel: 'team login',
  footer: (who: string) => `Airwallex: ${plainText(who)}`,
  handOff: (admins: string) =>
    `I can't create invoices with the team login. That needs a finance admin to sign in. ${admins ? `I've asked ${admins}.` : "I've asked the finance team."}`,
  onlyApprover: (adminName: string) => `Only ${plainText(adminName)} can approve this.`,
  approved: (adminName: string) => `Approved by ${plainText(adminName)}.`,
  cancelled: 'Cancelled.',
  created: (number: string, customer: string, url: string) => {
    const link = safeLink(url);
    return `Created invoice ${plainText(number)} for ${plainText(customer)}.${link ? ` <${link}|Open invoice>` : ''}`;
  },
  notCreated: (problem: string) => `I didn't create the invoice. ${plainText(problem)}`,
  card: {
    title: (customer: string) => `Invoice ${plainText(customer)}`,
    lineItem: 'Line item',
    amount: 'Amount',
    terms: 'Terms',
    termsValue: (days: number) => `Net ${days}`,
    requestedBy: (name: string, adminName: string) =>
      `Requested by ${plainText(name)}. This will be created with ${plainText(adminName)}'s Airwallex login.`,
    approve: 'Approve',
    cancel: 'Cancel',
  },
  connect: {
    own: {
      title: 'Connect your Airwallex',
      body: 'Creating invoices uses your own Airwallex login. Only you can see this.',
    },
    team: {
      title: "Connect the team's Airwallex",
      body: 'One shared login, view only, so anyone in the channel can ask about balances and invoices. Only you can see this.',
    },
  },
  page: {
    teamConnected: "The team's Airwallex is connected, view only. Go back to Slack and ask Till again.",
    ownConnected: 'Airwallex is connected. You can close this tab and go back to Slack.',
    notConnectedYet: 'Airwallex is not connected yet. Try the button in Slack again.',
    invalidLink: 'That link is not valid or has expired. Ask Till again in Slack.',
    failed: 'Something went wrong. Go back to Slack and try again.',
  },
} as const;
