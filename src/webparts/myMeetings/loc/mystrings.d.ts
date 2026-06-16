declare interface IMyMeetingsWebPartStrings {
  PropertyPaneDescription: string;
  ConnectionGroupName: string;
  EwsUrlFieldLabel: string;
  MailboxUrlFieldLabel: string;
  CacheGroupName: string;
  CacheMinutesFieldLabel: string;
}

declare module 'MyMeetingsWebPartStrings' {
  const strings: IMyMeetingsWebPartStrings;
  export = strings;
}
