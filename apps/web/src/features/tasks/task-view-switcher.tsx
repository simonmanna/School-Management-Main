import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Kanban, List, LayoutDashboard, Calendar } from 'lucide-react';
import { useTaskStore } from './task.store';
import type { TaskViewMode } from './task.store';

export function TaskViewSwitcher() {
  const { filters, setFilters } = useTaskStore();
  const [, setSearchParams] = useSearchParams();

  const handleTabChange = useCallback(
    (value: string) => {
      setFilters({ view: value as TaskViewMode });
      setSearchParams({ view: value });
    },
    [setFilters, setSearchParams],
  );

  return (
    <Tabs value={filters.view} onValueChange={handleTabChange}>
      <TabsList>
        <TabsTrigger value="kanban" className="flex items-center gap-1.5">
          <Kanban className="h-4 w-4" /> Kanban
        </TabsTrigger>
        <TabsTrigger value="list" className="flex items-center gap-1.5">
          <List className="h-4 w-4" /> List
        </TabsTrigger>
        <TabsTrigger value="dashboard" className="flex items-center gap-1.5">
          <LayoutDashboard className="h-4 w-4" /> Dashboard
        </TabsTrigger>
        <TabsTrigger value="calendar" className="flex items-center gap-1.5">
          <Calendar className="h-4 w-4" /> Calendar
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
