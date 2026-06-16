import * as React from 'react';
import styles from './MyMeetings.module.scss';

export interface IPaginationProps {
  pageCount: number;
  current: number;
  onSelect: (page: number) => void;
}

/** Horizontal dot pager. Renders nothing when there is a single page. */
export default class Pagination extends React.Component<IPaginationProps, {}> {
  public render(): JSX.Element | null {
    if (this.props.pageCount <= 1) {
      return null;
    }
    const dots: JSX.Element[] = [];
    for (let i: number = 0; i < this.props.pageCount; i++) {
      const active: boolean = i === this.props.current;
      dots.push(
        <button
          key={i}
          type="button"
          className={active ? `${styles.dot} ${styles.dotActive}` : styles.dot}
          aria-label={`Go to meetings page ${i + 1}`}
          aria-current={active ? 'true' : undefined}
          onClick={this.handleClick.bind(this, i)}
        />
      );
    }
    return <div className={styles.pagination} role="navigation" aria-label="Meeting pages">{dots}</div>;
  }

  private handleClick(index: number): void {
    if (index !== this.props.current) {
      this.props.onSelect(index);
    }
  }
}
