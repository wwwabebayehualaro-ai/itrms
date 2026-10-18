import { CalendarDays, ChartColumn, Kanban, LayoutGrid, Sheet, Table } from 'lucide-react';
import { registerViewMode } from '../registry';
import BoardView from './BoardView';
import CalendarView from './CalendarView';
import CardsView from './CardsView';
import DashboardView from './DashboardView';
import PivotView from './PivotView';
import TableView from './TableView';

// Built-in view modes. A feature adds its own with `registerViewMode` (see ../registry.ts).
registerViewMode({ id: 'table', label: 'Table', icon: Table, order: 10, component: TableView });
registerViewMode({ id: 'cards', label: 'Cards', icon: LayoutGrid, order: 20, component: CardsView });
registerViewMode({ id: 'board', label: 'Board', icon: Kanban, order: 30, component: BoardView });
registerViewMode({ id: 'calendar', label: 'Calendar', icon: CalendarDays, order: 40, component: CalendarView });
registerViewMode({ id: 'pivot', label: 'Pivot', icon: Sheet, order: 50, component: PivotView });
registerViewMode({ id: 'dashboard', label: 'Dashboard', icon: ChartColumn, order: 60, component: DashboardView });
