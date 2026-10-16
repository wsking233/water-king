import { Component, type ReactNode } from "react";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { appVersion } from "./build";
import { prepareRefresh } from "./offline";
import { abortable } from "./cloud/request";

/** An unexpected render failure must leave a usable recovery screen, never a blank app. */
export class AppRecovery extends Component<{children: ReactNode},{failed:boolean;busy:boolean;error:string}> {
  state={failed:false,busy:false,error:""};
  static getDerivedStateFromError(){return {failed:true};}
  async update(){
    if(this.state.busy)return;
    this.setState({busy:true,error:""});
    try{
      if(!navigator.onLine)throw Error("当前离线，可重新打开当前版本，或联网后获取更新。");
      await abortable(prepareRefresh(),AbortSignal.timeout(20000));
      window.location.reload();
    }catch{this.setState({busy:false,error:navigator.onLine?"暂时无法获取更新，请稍后重试。原有数据未被此操作清除。":"当前离线，可重新打开当前版本，或联网后获取更新。"});}
  }
  render(){
    if(!this.state.failed)return this.props.children;
    return <div className="app app-recovery"><main>
      <ShieldCheck size={36}/><h1>页面暂时无法显示</h1>
      <p>可以先重新打开应用。本次恢复不会主动清除本机记录，请不要清除浏览器数据。</p>
      {this.state.error&&<p className="account-error" role="alert">{this.state.error}</p>}
      <button className="primary" disabled={this.state.busy} onClick={()=>void this.update()}><RefreshCw size={18}/>{this.state.busy?"正在获取更新…":"获取更新后重新打开"}</button>
      <button className="secondary" disabled={this.state.busy} onClick={()=>window.location.reload()}>重新打开当前版本</button>
      <p className="recovery-version">水王 v{appVersion} · 如反复出现，请保留已有备份并稍后重试。</p>
    </main></div>;
  }
}
