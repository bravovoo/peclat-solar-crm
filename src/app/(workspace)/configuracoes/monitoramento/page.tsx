import {pageActor} from '@/server/session';
import {operationalSummary} from '@/modules/operations/monitoring';
import {OperationalMonitoring} from '@/components/operations/operational-monitoring';
export default async function MonitoringPage(){const actor=await pageActor();return <OperationalMonitoring initial={await operationalSummary(actor)}/>;}
