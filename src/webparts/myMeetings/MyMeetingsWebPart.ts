import * as React from 'react';
import * as ReactDom from 'react-dom';
import { Version } from '@microsoft/sp-core-library';
import {
  BaseClientSideWebPart,
  IPropertyPaneConfiguration,
  PropertyPaneTextField,
  PropertyPaneSlider,
  PropertyPaneLabel
} from '@microsoft/sp-webpart-base';

import * as strings from 'MyMeetingsWebPartStrings';
import MyMeetings from './components/MyMeetings';
import { IMyMeetingsProps } from './components/IMyMeetingsProps';

export interface IMyMeetingsWebPartProps {
  ewsUrl: string;
  mailboxUrl: string;
  cacheMinutes: number;
}

export default class MyMeetingsWebPart extends BaseClientSideWebPart<IMyMeetingsWebPartProps> {

  public render(): void {
    const element: React.ReactElement<IMyMeetingsProps> = React.createElement(
      MyMeetings,
      {
        ewsUrl: (this.properties.ewsUrl || '').trim(),
        mailboxUrl: (this.properties.mailboxUrl || '').trim(),
        cacheMinutes: typeof this.properties.cacheMinutes === 'number' ? this.properties.cacheMinutes : 5,
        displayMode: this.displayMode,
        userDisplayName: this.context.pageContext.user.displayName
      }
    );

    ReactDom.render(element, this.domElement);
  }

  protected onDispose(): void {
    // Unmount so in-flight fetches/timers are released with the component.
    ReactDom.unmountComponentAtNode(this.domElement);
  }

  protected get dataVersion(): Version {
    return Version.parse('1.0');
  }

  protected getPropertyPaneConfiguration(): IPropertyPaneConfiguration {
    return {
      pages: [
        {
          header: { description: strings.PropertyPaneDescription },
          groups: [
            {
              groupName: strings.ConnectionGroupName,
              groupFields: [
                PropertyPaneTextField('ewsUrl', {
                  label: strings.EwsUrlFieldLabel,
                  placeholder: 'https://mail.contoso.com/EWS/Exchange.asmx'
                }),
                PropertyPaneTextField('mailboxUrl', {
                  label: strings.MailboxUrlFieldLabel,
                  placeholder: 'https://mail.contoso.com/owa'
                })
              ]
            },
            {
              groupName: strings.CacheGroupName,
              groupFields: [
                PropertyPaneSlider('cacheMinutes', {
                  label: strings.CacheMinutesFieldLabel,
                  min: 0,
                  max: 60,
                  step: 1,
                  showValue: true,
                  value: 5
                }),
                PropertyPaneLabel('cacheHint', {
                  text: 'Cached weeks are kept per browser session. Set to 0 to always fetch live.'
                })
              ]
            }
          ]
        }
      ]
    };
  }
}
