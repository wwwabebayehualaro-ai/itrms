import { CalendarDays, ChartColumn, Kanban, LayoutGrid, Sheet, Table } from 'lucide-react';
import { registerViewMode } from '../registry';
import BoardView from './BoardView';
import CalendarView from './CalendarView';
import CardsView from './CardsView';
import DashboardView from './DashboardView';
import PivotView from './PivotView';
import TableView from './TableView';

// Built-in view modes. A feature adds its own with `registerViewMode` (see ../registry.ts).
registerViewMode({
    id: 'table',
    labelKey: 'form-engine.viewer.mode.table',
    icon: Table,
    order: 10,
    component: TableView
});
registerViewMode({
    id: 'cards',
    labelKey: 'form-engine.viewer.mode.cards',
    icon: LayoutGrid,
    order: 20,
    component: CardsView
});
registerViewMode({
    id: 'board',
    labelKey: 'form-engine.viewer.mode.board',
    icon: Kanban,
    order: 30,
    component: BoardView
});
registerViewMode({
    id: 'calendar',
    labelKey: 'form-engine.viewer.mode.calendar',
    icon: CalendarDays,
    order: 40,
    component: CalendarView
});
registerViewMode({
    id: 'pivot',
    labelKey: 'form-engine.viewer.mode.pivot',
    icon: Sheet,
    order: 50,
    component: PivotView
});
registerViewMode({
    id: 'dashboard',
    labelKey: 'form-engine.viewer.mode.dashboard',
    icon: ChartColumn,
    order: 60,
    component: DashboardView
});
